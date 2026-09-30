/**
 * Um servidor no lugar da Asaas, só para o e2e.
 *
 * O painel fala HTTP de verdade com ele (o `ASAAS_API_URL` do
 * `scripts/e2e-local.sh` aponta para cá), com as mesmas rotas, o mesmo
 * cabeçalho `access_token` e o mesmo formato de resposta e de erro da API v3.
 * É o que deixa o teste provar o fluxo do painel inteiro — assinar, pagar
 * (pelo aviso), trocar e cancelar — sem uma conta na Asaas. A integração com a
 * Asaas de verdade é conferida no sandbox dela (PLANO, Fase 7).
 *
 * Tudo aqui é dado de teste, em memória, e some quando o teste termina.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface PedidoRecebido {
  metodo: string;
  caminho: string;
  chave: string | undefined;
  corpo: Record<string, unknown> | null;
}

export interface Pagamento {
  id: string;
  subscription: string;
  customer: string;
  value: number;
  status: string;
  dueDate: string;
  invoiceUrl: string;
  deleted: boolean;
  /** Quando o cliente pagou: a Asaas só manda nas cobranças recebidas. */
  clientPaymentDate?: string;
}

interface Assinatura {
  id: string;
  customer: string;
  value: number;
  nextDueDate: string;
  description: string;
  deleted: boolean;
}

export class AsaasDeTeste {
  readonly pedidos: PedidoRecebido[] = [];
  readonly pagamentos: Pagamento[] = [];
  private readonly assinaturas = new Map<string, Assinatura>();
  private contador = 0;
  private servidor: Server | null = null;

  constructor(
    private readonly porta: number,
    private readonly chave: string,
  ) {}

  async ligar(): Promise<void> {
    this.servidor = createServer((pedido, resposta) => {
      void this.atender(pedido, resposta);
    });
    await new Promise<void>((pronto, falhou) => {
      this.servidor?.once('error', falhou);
      this.servidor?.listen(this.porta, '127.0.0.1', () => {
        pronto();
      });
    });
  }

  async desligar(): Promise<void> {
    await new Promise<void>((pronto) => {
      if (this.servidor === null) {
        pronto();
        return;
      }
      this.servidor.close(() => {
        pronto();
      });
    });
  }

  /** Um campo de texto do corpo, ou o reserva. */
  private static texto(corpo: Record<string, unknown> | null, campo: string, reserva = ''): string {
    const valor = corpo?.[campo];
    return typeof valor === 'string' ? valor : reserva;
  }

  private proximo(prefixo: string): string {
    this.contador += 1;
    return `${prefixo}_e2e_${String(this.contador)}`;
  }

  private async atender(pedido: IncomingMessage, resposta: ServerResponse): Promise<void> {
    const partes: Buffer[] = [];
    for await (const parte of pedido) partes.push(parte as Buffer);
    const texto = Buffer.concat(partes).toString('utf8');
    const corpo = texto === '' ? null : (JSON.parse(texto) as Record<string, unknown>);
    // Sem a query (`?limit=100`): as rotas casam pelo caminho, como na Asaas.
    const caminho = (pedido.url ?? '').replace(/^\/v3/, '').replace(/\?.*$/, '');
    const metodo = pedido.method ?? 'GET';
    const chave = pedido.headers.access_token;
    this.pedidos.push({
      metodo,
      caminho,
      chave: typeof chave === 'string' ? chave : undefined,
      corpo,
    });

    const responder = (status: number, dados: unknown) => {
      resposta.writeHead(status, { 'Content-Type': 'application/json' });
      resposta.end(JSON.stringify(dados));
    };

    if (chave !== this.chave) {
      responder(401, {
        errors: [{ code: 'invalid_access_token', description: 'Chave inválida.' }],
      });
      return;
    }

    if (metodo === 'POST' && caminho === '/customers') {
      const documento = typeof corpo?.cpfCnpj === 'string' ? corpo.cpfCnpj : '';
      if (!/^[0-9A-Z]{11}$|^[0-9A-Z]{14}$/.test(documento)) {
        responder(400, {
          errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }],
        });
        return;
      }
      responder(200, { object: 'customer', id: this.proximo('cus'), ...corpo });
      return;
    }

    const cliente = /^\/customers\/([^/]+)$/.exec(caminho);
    if (metodo === 'PUT' && cliente !== null) {
      responder(200, { object: 'customer', id: cliente[1], ...corpo });
      return;
    }

    if (metodo === 'POST' && caminho === '/subscriptions') {
      const assinatura: Assinatura = {
        id: this.proximo('sub'),
        customer: AsaasDeTeste.texto(corpo, 'customer'),
        value: Number(corpo?.value ?? 0),
        nextDueDate: AsaasDeTeste.texto(corpo, 'nextDueDate'),
        description: AsaasDeTeste.texto(corpo, 'description'),
        deleted: false,
      };
      this.assinaturas.set(assinatura.id, assinatura);
      // Como a Asaas: a assinatura já nasce com a primeira cobrança.
      const pagamento = this.proximo('pay');
      this.pagamentos.push({
        id: pagamento,
        subscription: assinatura.id,
        customer: assinatura.customer,
        value: assinatura.value,
        status: 'PENDING',
        dueDate: assinatura.nextDueDate,
        invoiceUrl: `https://sandbox.asaas.com/i/${pagamento}`,
        deleted: false,
      });
      responder(200, { object: 'subscription', status: 'ACTIVE', ...assinatura });
      return;
    }

    const umaAssinatura = /^\/subscriptions\/([^/]+)$/.exec(caminho);
    const assinatura =
      umaAssinatura === null ? undefined : this.assinaturas.get(umaAssinatura[1] ?? '');
    if (umaAssinatura !== null && (assinatura === undefined || assinatura.deleted)) {
      responder(404, {
        errors: [{ code: 'not_found', description: 'Assinatura não encontrada.' }],
      });
      return;
    }
    if (metodo === 'PUT' && assinatura !== undefined) {
      assinatura.value = Number(corpo?.value ?? assinatura.value);
      assinatura.description = AsaasDeTeste.texto(corpo, 'description', assinatura.description);
      if (corpo?.updatePendingPayments === true) {
        for (const pagamento of this.pagamentos) {
          if (pagamento.subscription === assinatura.id && pagamento.status === 'PENDING') {
            pagamento.value = assinatura.value;
          }
        }
      }
      responder(200, { object: 'subscription', ...assinatura });
      return;
    }
    if (metodo === 'DELETE' && assinatura !== undefined) {
      assinatura.deleted = true;
      for (const pagamento of this.pagamentos) {
        if (pagamento.subscription === assinatura.id && pagamento.status === 'PENDING') {
          pagamento.deleted = true;
        }
      }
      responder(200, { deleted: true, id: assinatura.id });
      return;
    }

    const lista = /^\/subscriptions\/([^/]+)\/payments$/.exec(caminho);
    if (metodo === 'GET' && lista !== null) {
      const dados = this.pagamentos.filter((p) => p.subscription === lista[1] && !p.deleted);
      responder(200, { object: 'list', hasMore: false, totalCount: dados.length, data: dados });
      return;
    }

    // Uma cobrança pelo id: a removida volta marcada, como na Asaas.
    const umPagamento = /^\/payments\/([^/]+)$/.exec(caminho);
    if (metodo === 'GET' && umPagamento !== null) {
      const pagamento = this.pagamentos.find((p) => p.id === umPagamento[1]);
      if (pagamento === undefined) {
        responder(404, {
          errors: [{ code: 'not_found', description: 'Cobrança não encontrada.' }],
        });
        return;
      }
      responder(200, { object: 'payment', ...pagamento });
      return;
    }

    responder(404, { errors: [{ code: 'not_found', description: 'Rota desconhecida.' }] });
  }
}
