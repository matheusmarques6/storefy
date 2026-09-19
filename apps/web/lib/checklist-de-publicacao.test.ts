import { describe, expect, it } from 'vitest';
import {
  MAXIMO_DO_NOME,
  checklistDaPlataforma,
  montarChecklist,
  pendencias,
  podePublicar,
  type EstadoDaPublicacao,
} from '@/lib/checklist-de-publicacao';

const PRONTO: EstadoDaPublicacao = {
  nomeDoApp: 'Oak Vintage',
  versaoPublicada: 3,
  iconePronto: true,
  splashPronta: true,
  bundleIdIos: 'com.oakvintage.app',
  packageAndroid: 'com.oakvintage.app',
  appleConectada: true,
  googleConectada: true,
  pushLigado: true,
};

describe('montarChecklist', () => {
  it('com tudo pronto, publica nas duas plataformas', () => {
    const itens = montarChecklist(PRONTO);
    expect(podePublicar(itens, 'ios')).toBe(true);
    expect(podePublicar(itens, 'android')).toBe(true);
    expect(pendencias(itens, 'ios')).toEqual([]);
  });

  /*
   * O push é a única recomendação: dá para publicar sem. Tratá-lo como
   * obrigatório prenderia o lojista numa configuração que depende de chaves
   * que ele talvez ainda não tenha.
   */
  it('sem push ainda publica: é recomendação, não exigência', () => {
    const itens = montarChecklist({ ...PRONTO, pushLigado: false });
    expect(podePublicar(itens, 'ios')).toBe(true);
    expect(itens.find((item) => item.chave === 'push')?.obrigatorio).toBe(false);
  });

  it('cada exigência que falta impede a publicação', () => {
    const casos: [Partial<EstadoDaPublicacao>, string][] = [
      [{ nomeDoApp: '   ' }, 'nome'],
      [{ versaoPublicada: null }, 'config'],
      [{ iconePronto: false }, 'icone'],
      [{ splashPronta: false }, 'splash'],
    ];
    for (const [faltando, chave] of casos) {
      const itens = montarChecklist({ ...PRONTO, ...faltando });
      expect(podePublicar(itens, 'ios')).toBe(false);
      expect(pendencias(itens, 'ios').map((item) => item.chave)).toContain(chave);
    }
  });

  /*
   * Acima de 30 caracteres a Apple TRUNCA sem avisar, e o app vai para a loja
   * com o nome cortado no meio — que é como o cliente final vai encontrá-lo
   * para sempre. Barrar antes custa um campo; descobrir depois custa uma
   * submissão nova.
   */
  it('nome longo demais barra, e a mensagem diz o tamanho', () => {
    const itens = montarChecklist({ ...PRONTO, nomeDoApp: 'a'.repeat(MAXIMO_DO_NOME + 1) });
    expect(podePublicar(itens, 'ios')).toBe(false);

    const item = itens.find((i) => i.chave === 'nome');
    expect(item?.comoResolver).toContain(String(MAXIMO_DO_NOME + 1));
    expect(item?.comoResolver).toContain(String(MAXIMO_DO_NOME));
  });

  it('nome exatamente no limite passa', () => {
    expect(
      podePublicar(montarChecklist({ ...PRONTO, nomeDoApp: 'a'.repeat(MAXIMO_DO_NOME) }), 'ios'),
    ).toBe(true);
  });

  /*
   * As plataformas são independentes: quem só conectou o Google ainda publica
   * no Android. Exigir as duas faria o lojista esperar pela conta mais cara
   * (a da Apple, US$ 99/ano) para lançar em qualquer lugar.
   */
  it('só a conta Apple conectada publica no iOS, e não no Android', () => {
    const itens = montarChecklist({ ...PRONTO, googleConectada: false, packageAndroid: null });
    expect(podePublicar(itens, 'ios')).toBe(true);
    expect(podePublicar(itens, 'android')).toBe(false);
  });

  it('só a conta Google conectada publica no Android, e não no iOS', () => {
    const itens = montarChecklist({ ...PRONTO, appleConectada: false, bundleIdIos: null });
    expect(podePublicar(itens, 'android')).toBe(true);
    expect(podePublicar(itens, 'ios')).toBe(false);
  });

  it('o checklist de cada plataforma traz os gerais mais os dela', () => {
    const itens = montarChecklist(PRONTO);
    const ios = checklistDaPlataforma(itens, 'ios').map((item) => item.chave);

    expect(ios).toContain('nome');
    expect(ios).toContain('apple');
    expect(ios).not.toContain('google');
    expect(ios).not.toContain('package');
  });

  it('cada item diz o que fazer, sem jargão e sem nome de coluna', () => {
    for (const item of montarChecklist({
      nomeDoApp: '',
      versaoPublicada: null,
      iconePronto: false,
      splashPronta: false,
      bundleIdIos: null,
      packageAndroid: null,
      appleConectada: false,
      googleConectada: false,
      pushLigado: false,
    })) {
      expect(item.titulo.length).toBeGreaterThan(5);
      expect(item.comoResolver.length).toBeGreaterThan(20);
      expect(item.comoResolver).not.toMatch(/null|undefined|_enc|app_configs|bundle_id/);
    }
  });

  it('o ícone avisa das duas recusas clássicas da Apple', () => {
    const item = montarChecklist({ ...PRONTO, iconePronto: false }).find(
      (i) => i.chave === 'icone',
    );
    expect(item?.comoResolver).toContain('1024');
    expect(item?.comoResolver).toContain('transparência');
  });
});
