import { describe, expect, it } from 'vitest';
import { mereceAviso, montarAviso, type DadosDoAviso } from '@/lib/aviso-da-revisao';

const BASE: DadosDoAviso = {
  decisao: 'approved',
  nomeDaLoja: 'Loja da Ana',
  plataforma: 'ios',
  motivo: null,
  url: 'https://app.storefy.com.br/publicacao',
};

describe('mereceAviso', () => {
  /*
   * Aprovado e recusado pedem uma ação do lojista. `in_review` é informação, e
   * mandar os três transformaria três dias de espera em três e-mails — o
   * terceiro lido com a mesma atenção do segundo: nenhuma.
   */
  it('só as decisões que pedem ação', () => {
    expect(mereceAviso('approved')).toBe(true);
    expect(mereceAviso('rejected')).toBe(true);

    for (const status of ['in_review', 'submitted', 'queued', 'building', 'finished', '']) {
      expect(mereceAviso(status)).toBe(false);
    }
  });
});

describe('montarAviso', () => {
  it('aprovação diz o que aconteceu e o que fazer', () => {
    const aviso = montarAviso(BASE);
    expect(aviso.assunto).toContain('Loja da Ana');
    expect(aviso.assunto).toContain('aprovado');
    expect(aviso.assunto).toContain('App Store');
    expect(aviso.texto).toContain('passou na revisão');
  });

  it('recusa leva o motivo traduzido, no texto e no HTML', () => {
    const aviso = montarAviso({
      ...BASE,
      decisao: 'rejected',
      motivo: 'A Apple recusou as informações da ficha do app.',
    });

    expect(aviso.assunto).toContain('não passou');
    expect(aviso.texto).toContain('ficha do app');
    expect(aviso.html).toContain('ficha do app');
  });

  it('recusa sem motivo ainda diz onde olhar', () => {
    const aviso = montarAviso({ ...BASE, decisao: 'rejected', motivo: null });
    expect(aviso.texto).toContain('conta de desenvolvedor');
    expect(aviso.texto).not.toContain('null');
  });

  it('a plataforma muda o nome da loja de aplicativos', () => {
    expect(montarAviso({ ...BASE, plataforma: 'android' }).assunto).toContain('Play Store');
    expect(montarAviso({ ...BASE, plataforma: 'ios' }).assunto).toContain('App Store');
  });

  /** Loja sem nome não vira "O app de  foi aprovado". */
  it('loja sem nome ganha um jeito de ser chamada', () => {
    for (const nome of ['', '   ']) {
      const aviso = montarAviso({ ...BASE, nomeDaLoja: nome });
      expect(aviso.assunto).toContain('sua loja');
      expect(aviso.assunto).not.toMatch(/ {2}/);
    }
  });

  /*
   * O nome vem do lojista. Sem escapar, um nome com `<` quebraria o layout do
   * e-mail de todo mundo daquela organização.
   */
  it('nome com marcação não escapa para dentro do HTML', () => {
    const aviso = montarAviso({ ...BASE, nomeDaLoja: '<b>Loja</b>' });
    expect(aviso.html).not.toContain('<b>Loja</b>');
    expect(aviso.html).toContain('&lt;b&gt;Loja&lt;/b&gt;');
  });

  /*
   * Texto puro vai junto com o HTML SEMPRE. Cliente que bloqueia HTML — e
   * filtro de spam — leem essa versão; um e-mail só com HTML chega vazio para
   * uma parte dos lojistas.
   */
  it('todo aviso tem versão em texto e em HTML', () => {
    for (const decisao of ['approved', 'rejected'] as const) {
      const aviso = montarAviso({ ...BASE, decisao });
      expect(aviso.texto.length).toBeGreaterThan(40);
      expect(aviso.html).toContain('<html');
      expect(aviso.html).toContain(BASE.url);
    }
  });

  /*
   * O estilo é em linha, e o layout é em tabela, porque Gmail, Outlook e Yahoo
   * descartam `<style>` e não aplicam flexbox — os três clientes em que quase
   * todo lojista lê e-mail.
   */
  it('o HTML é do tipo que os clientes de e-mail entendem', () => {
    const aviso = montarAviso(BASE);
    expect(aviso.html).not.toContain('<style');
    expect(aviso.html).not.toContain('display:flex');
    expect(aviso.html).toContain('<table');
  });

  /** O link não é repetido: ele já está no botão. */
  it('o corpo do HTML não repete a URL como texto solto', () => {
    const aviso = montarAviso(BASE);
    const ocorrencias = aviso.html.split(BASE.url).length - 1;
    expect(ocorrencias).toBe(1);
  });
});
