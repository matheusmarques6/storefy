'use client';

/**
 * O seletor de produto e coleção do composer (C08).
 *
 * O campo de deep link continua existindo e continua editável: um lojista que
 * sabe o caminho que quer não deve ser obrigado a procurar na lista. O seletor
 * é um atalho ao lado dele, e não uma troca — tirar o campo livre custaria o
 * link para uma página que não é produto nem coleção, como uma landing de
 * campanha.
 *
 * A busca acontece enquanto digita, com uma espera curta: sem ela, cada letra
 * viraria três chamadas à Shopify na conta do lojista.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Package, Search, Tag, X } from 'lucide-react';
import { LIMITE_DA_BUSCA, type ItemDoCatalogo } from '@/lib/catalogo';
import type { ResultadoDaBusca } from '@/lib/catalogo-servidor';
import { buscarProdutos } from './acoes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Espera entre a última tecla e a busca. */
const ESPERA_MS = 350;

/**
 * Quem busca.
 *
 * Parametrizado com a Server Action por padrão, e não amarrado a ela: é a
 * mesma costura que o resto do código usa para o `fetch`, e é o que deixa esta
 * tela ser aberta num navegador de teste sem uma sessão de lojista por trás.
 */
export type Buscador = (termo: string) => Promise<ResultadoDaBusca>;

export function SeletorDoCatalogo({
  aoEscolher,
  buscar = buscarProdutos,
}: {
  aoEscolher: (caminho: string) => void;
  buscar?: Buscador;
}) {
  const [aberto, setAberto] = useState(false);

  if (!aberto) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setAberto(true);
        }}
      >
        <Search className="size-4" aria-hidden />
        Escolher produto ou coleção
      </Button>
    );
  }

  return (
    <Busca
      buscar={buscar}
      aoEscolher={(caminho) => {
        aoEscolher(caminho);
        setAberto(false);
      }}
      aoFechar={() => {
        setAberto(false);
      }}
    />
  );
}

function Busca({
  buscar,
  aoEscolher,
  aoFechar,
}: {
  buscar: Buscador;
  aoEscolher: (caminho: string) => void;
  aoFechar: () => void;
}) {
  const [termo, setTermo] = useState('');
  const [itens, setItens] = useState<ItemDoCatalogo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, iniciar] = useTransition();
  const campo = useRef<HTMLInputElement>(null);

  /*
   * A primeira busca sai sem termo nenhum: a Shopify devolve os produtos mais
   * recentes, e o lojista vê uma lista em vez de um campo vazio pedindo que
   * ele adivinhe o nome exato do produto.
   */
  useEffect(() => {
    campo.current?.focus();

    const relogio = setTimeout(() => {
      iniciar(async () => {
        const resultado = await buscar(termo);
        if (resultado.ok) {
          setItens(resultado.itens);
          setErro(null);
        } else {
          setItens([]);
          setErro(resultado.motivo);
        }
      });
    }, ESPERA_MS);

    return () => {
      clearTimeout(relogio);
    };
  }, [termo, buscar]);

  return (
    <div className="border-input space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input
          ref={campo}
          value={termo}
          onChange={(evento) => {
            setTermo(evento.target.value);
          }}
          placeholder="Buscar produto ou coleção"
          aria-label="Buscar produto ou coleção"
          maxLength={100}
        />
        <Button type="button" variant="ghost" size="sm" onClick={aoFechar} aria-label="Fechar">
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {buscando ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Procurando na sua loja...
        </p>
      ) : erro !== null ? (
        <p className="text-muted-foreground text-sm">{erro}</p>
      ) : itens.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {termo.trim() === ''
            ? 'Nenhum produto publicado nesta loja ainda.'
            : `Nada encontrado para “${termo.trim()}”.`}
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="Resultados">
          {itens.map((item) => (
            <li key={`${item.tipo}-${item.id}`}>
              <button
                type="button"
                onClick={() => {
                  aoEscolher(item.caminho);
                }}
                className="hover:bg-accent flex w-full items-center gap-3 rounded-md p-2 text-left"
              >
                {item.imagem === null ? (
                  <span className="bg-muted flex size-10 flex-none items-center justify-center rounded">
                    {item.tipo === 'produto' ? (
                      <Package className="text-muted-foreground size-4" aria-hidden />
                    ) : (
                      <Tag className="text-muted-foreground size-4" aria-hidden />
                    )}
                  </span>
                ) : (
                  /*
                   * `<img>` e não `next/image`: a miniatura vem do CDN da loja
                   * DO CLIENTE, e cada loja tem o seu. Otimizá-la exigiria
                   * liberar um domínio curinga no `next.config`, o que é bem
                   * pior do que não otimizar uma imagem de 40 pixels. A regra
                   * está desligada para este arquivo no `eslint.config.mjs`.
                   */
                  <img
                    src={item.imagem}
                    alt=""
                    width={40}
                    height={40}
                    className="size-10 flex-none rounded object-cover"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.titulo}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {item.tipo === 'produto' ? 'Produto' : 'Coleção'} · {item.caminho}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {itens.length >= LIMITE_DA_BUSCA ? (
        <p className="text-muted-foreground text-xs">
          Mostrando os primeiros resultados. Refine a busca para achar o que procura.
        </p>
      ) : null}
    </div>
  );
}
