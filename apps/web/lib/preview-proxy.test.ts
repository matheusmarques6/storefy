import { describe, expect, it } from 'vitest';
import {
  MARCA_DA_PREVIA,
  cssDaPrevia,
  destinoDaPrevia,
  dominioPermitido,
  ehHostPublico,
  prepararHtmlDaPrevia,
} from '@/lib/preview-proxy';

const LOJA = 'https://oakvintage.com.br';
const DOMINIOS = ['oakvintage.com.br', 'oak-vintage.myshopify.com'];

describe('ehHostPublico', () => {
  it('RECUSA o endereço de metadados da nuvem', () => {
    // Alcançá-lo entrega credencial de máquina. É o alvo número um de SSRF.
    expect(ehHostPublico('169.254.169.254')).toBe(false);
    expect(ehHostPublico('169.254.0.1')).toBe(false);
  });

  it('recusa loopback e faixas privadas', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '::1',
      '[::1]',
      'fd00::1',
      'fe80::1',
      'banco.internal',
      'painel.local',
      'app.localhost',
      'intranet',
      'db',
      '',
      '   ',
    ]) {
      expect(ehHostPublico(host), host).toBe(false);
    }
  });

  it('aceita hospedeiro público de verdade', () => {
    for (const host of [
      'oakvintage.com.br',
      'www.oakvintage.com.br',
      'oak-vintage.myshopify.com',
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '2606:4700::1',
    ]) {
      expect(ehHostPublico(host), host).toBe(true);
    }
  });
});

describe('dominioPermitido', () => {
  it('aceita o domínio da loja e seus subdomínios', () => {
    expect(dominioPermitido('oakvintage.com.br', DOMINIOS)).toBe(true);
    expect(dominioPermitido('www.oakvintage.com.br', DOMINIOS)).toBe(true);
    expect(dominioPermitido('blog.oakvintage.com.br', DOMINIOS)).toBe(true);
  });

  it('NÃO cai no truque do sufixo', () => {
    // `endsWith` ingênuo deixaria estes passarem, e é assim que se faz
    // phishing em cima de uma lista de domínios.
    expect(dominioPermitido('oakvintage.com.br.evil.com', DOMINIOS)).toBe(false);
    expect(dominioPermitido('evil-oakvintage.com.br', DOMINIOS)).toBe(false);
  });

  it('recusa domínio de fora', () => {
    expect(dominioPermitido('google.com', DOMINIOS)).toBe(false);
    expect(dominioPermitido('', DOMINIOS)).toBe(false);
    expect(dominioPermitido('oakvintage.com.br', [])).toBe(false);
    expect(dominioPermitido('oakvintage.com.br', ['  ', 'não é url'])).toBe(false);
  });
});

describe('destinoDaPrevia', () => {
  it('monta o endereço a partir do caminho pedido', () => {
    expect(destinoDaPrevia(LOJA, '/collections/novidades', DOMINIOS)).toEqual({
      ok: true,
      url: 'https://oakvintage.com.br/collections/novidades',
    });
  });

  it('caminho vazio vira a página inicial', () => {
    expect(destinoDaPrevia(LOJA, '', DOMINIOS)).toEqual({
      ok: true,
      url: 'https://oakvintage.com.br/',
    });
  });

  it('RECUSA endereço absoluto para fora da loja', () => {
    // É o que um parâmetro forjado tentaria: transformar a prévia num proxy
    // aberto para qualquer lugar da internet — e da rede interna.
    for (const alvo of [
      'https://google.com/',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/admin',
      'http://10.0.0.1/',
      'https://oakvintage.com.br.evil.com/',
    ]) {
      const resultado = destinoDaPrevia(LOJA, alvo, DOMINIOS);
      expect(resultado.ok, alvo).toBe(false);
    }
  });

  it('recusa esquema que não é http nem https', () => {
    for (const alvo of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<h1>x']) {
      expect(destinoDaPrevia(LOJA, alvo, DOMINIOS).ok, alvo).toBe(false);
    }
  });

  it('aceita outro domínio que a própria loja registrou', () => {
    const resultado = destinoDaPrevia(LOJA, 'https://oak-vintage.myshopify.com/cart', DOMINIOS);
    expect(resultado.ok).toBe(true);
  });

  it('recusa quando a loja tem endereço inválido no cadastro', () => {
    expect(destinoDaPrevia('não é url', '/', DOMINIOS).ok).toBe(false);
  });

  it('nenhuma recusa conta o que houve por dentro', () => {
    for (const alvo of ['http://10.0.0.1/', 'https://google.com/', 'file:///etc/passwd']) {
      const resultado = destinoDaPrevia(LOJA, alvo, DOMINIOS);
      if (resultado.ok) throw new Error('deveria ter recusado');
      expect(resultado.motivo).not.toMatch(/10\.0\.0|metadata|127\./);
    }
  });
});

describe('prepararHtmlDaPrevia', () => {
  const opcoes = { base: 'https://oakvintage.com.br/', css: 'header{display:none !important;}' };

  it('põe o base para os assets saírem direto da loja', () => {
    // Sem isso, cada `/assets/x.css` do tema viraria uma requisição ao painel.
    const saida = prepararHtmlDaPrevia(
      '<html><head><title>Loja</title></head><body>oi</body></html>',
      opcoes,
    );
    expect(saida).toContain('<base href="https://oakvintage.com.br/">');
    expect(saida.indexOf('<base')).toBeLessThan(saida.indexOf('<title>'));
  });

  it('injeta o CSS de esconder com a nossa marca', () => {
    const saida = prepararHtmlDaPrevia('<html><head></head><body></body></html>', opcoes);
    expect(saida).toContain(`id="${MARCA_DA_PREVIA}-estilo"`);
    expect(saida).toContain('header{display:none !important;}');
  });

  it('remove o base do próprio tema, que apontaria para outro lugar', () => {
    const saida = prepararHtmlDaPrevia(
      '<html><head><base href="https://cdn.outro.com/"></head><body></body></html>',
      opcoes,
    );
    expect(saida).not.toContain('cdn.outro.com');
    expect(saida).toContain('<base href="https://oakvintage.com.br/">');
  });

  it('remove as metatags que deixariam a prévia em branco', () => {
    const html = `<html><head>
      <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">
      <meta http-equiv="X-Frame-Options" content="DENY">
    </head><body></body></html>`;
    const saida = prepararHtmlDaPrevia(html, opcoes);
    expect(saida).not.toMatch(/frame-ancestors/i);
    expect(saida).not.toMatch(/X-Frame-Options/i);
  });

  it('escapa o base, que vem de dado do banco', () => {
    const saida = prepararHtmlDaPrevia('<html><head></head></html>', {
      ...opcoes,
      base: 'https://loja.com/"><script>alert(1)</script>',
    });
    // A aspa é o único caractere que escapa de dentro de um atributo entre
    // aspas duplas; `<` e `>` ali dentro são texto. Basta ela estar escapada
    // para o `<script>` do exemplo continuar sendo só o valor do href.
    expect(saida).not.toContain('"><script>alert(1)');
    expect(saida).toContain('&quot;');

    const atributo = /<base href="([^"]*)"/.exec(saida)?.[1] ?? '';
    expect(atributo).not.toContain('<script');
    expect(atributo.startsWith('https://loja.com/')).toBe(true);
  });

  it('funciona com tema que não abre head', () => {
    const saida = prepararHtmlDaPrevia('<html><body>só corpo</body></html>', opcoes);
    expect(saida).toContain('<base href=');
    expect(saida).toContain('só corpo');
  });

  it('funciona até com resposta que não é HTML inteiro', () => {
    const saida = prepararHtmlDaPrevia('erro 500 do servidor da loja', opcoes);
    expect(saida).toContain('<base href=');
    expect(saida).toContain('erro 500');
  });

  it('injeta o script quando há um', () => {
    const saida = prepararHtmlDaPrevia('<html><head></head></html>', {
      ...opcoes,
      js: 'window.x=1;',
    });
    expect(saida).toContain(`id="${MARCA_DA_PREVIA}-script"`);
    expect(saida).toContain('window.x=1;');
  });
});

describe('cssDaPrevia', () => {
  it('uma regra por seletor, igual ao app', () => {
    expect(cssDaPrevia(['header', '.rodape'])).toBe(
      'header{display:none !important;}\n.rodape{display:none !important;}',
    );
  });

  it('descarta vazio e seletor com chave', () => {
    expect(cssDaPrevia(['', '   ', 'body{color:red}', 'header'])).toBe(
      'header{display:none !important;}',
    );
  });

  it('lista vazia não vira CSS nenhum', () => {
    expect(cssDaPrevia([])).toBe('');
  });
});
