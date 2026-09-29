import { describe, expect, it } from 'vitest';
import {
  PADRAO,
  TAMANHO_MAXIMO_DO_AVISO,
  conferirAviso,
  lerConfiguracoes,
} from '@/lib/configuracoes-da-plataforma';

describe('lerConfiguracoes', () => {
  it('sem nada no banco, vale o padrão: cadastro aberto e nenhum aviso', () => {
    expect(lerConfiguracoes([])).toEqual(PADRAO);
    expect(PADRAO).toEqual({ cadastroAberto: true, avisoNoPainel: '' });
  });

  it('lê o que foi mudado', () => {
    expect(
      lerConfiguracoes([
        { chave: 'cadastro_aberto', valor: false },
        { chave: 'aviso_no_painel', valor: '  Manutenção hoje às 23h.  ' },
      ]),
    ).toEqual({ cadastroAberto: false, avisoNoPainel: 'Manutenção hoje às 23h.' });
  });

  /*
   * Estas chaves são lidas em toda tela do painel. Um valor de tipo errado —
   * gravado à mão no banco, numa versão futura — vira o padrão em vez de
   * derrubar o painel de todos os lojistas.
   */
  it('valor de tipo errado vira o padrão, sem estourar', () => {
    expect(
      lerConfiguracoes([
        { chave: 'cadastro_aberto', valor: 'false' },
        { chave: 'aviso_no_painel', valor: { texto: 'x' } },
      ]),
    ).toEqual(PADRAO);
  });

  it('aviso longo demais é cortado na leitura', () => {
    const lido = lerConfiguracoes([{ chave: 'aviso_no_painel', valor: 'a'.repeat(500) }]);
    expect(lido.avisoNoPainel).toHaveLength(TAMANHO_MAXIMO_DO_AVISO);
  });
});

describe('conferirAviso', () => {
  it('aceita e arruma os espaços', () => {
    expect(conferirAviso('  Manutenção   às 23h. ')).toEqual({
      ok: true,
      aviso: 'Manutenção às 23h.',
    });
  });

  it('vazio desliga o aviso', () => {
    expect(conferirAviso('   ')).toEqual({ ok: true, aviso: '' });
  });

  it('recusa comunicado longo', () => {
    expect(conferirAviso('a'.repeat(TAMANHO_MAXIMO_DO_AVISO + 1)).ok).toBe(false);
  });
});
