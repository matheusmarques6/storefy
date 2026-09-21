/*
 * O banner "baixe nosso app", no site da loja (seção 5.6 do plano).
 *
 * Este arquivo roda na VITRINE DE QUEM NOS PAGA. Ele não pode quebrar a loja,
 * não pode atrasar o carregamento e não pode aparecer onde não faz sentido.
 * Daí as três guardas antes de qualquer coisa:
 *
 *   dentro do app não aparece — `window.__STOREFY__` existe só lá, e convidar
 *   a baixar o app quem já está no app é o tipo de detalhe que faz o cliente
 *   duvidar do resto;
 *   no computador não aparece — o link leva para uma loja de aplicativos de
 *   celular, e no desktop ele é um beco sem saída;
 *   depois de dispensado não aparece de novo por trinta dias.
 *
 * Tudo dentro de try: uma exceção nossa aqui vira bug da loja no console do
 * lojista, e ele não tem como saber que veio daqui.
 */
(function () {
  'use strict';

  var CHAVE = 'storefy_banner_dispensado';
  var DIAS = 30;

  try {
    if (window.__STOREFY_BANNER__) return;
    window.__STOREFY_BANNER__ = true;

    // Dentro do app: o convite não faz sentido.
    if (window.__STOREFY__) return;

    var plataforma = detectar(navigator.userAgent || '');
    if (!plataforma) return;
    if (dispensadoRecentemente()) return;

    var script = document.currentScript || document.querySelector('[data-storefy-loja]');
    if (!script) return;

    var loja = script.getAttribute('data-storefy-loja') || '';
    var api = (script.getAttribute('data-storefy-api') || '').replace(/\/+$/, '');
    if (!loja || !api) return;

    fetch(api + '/api/public/banner/' + encodeURIComponent(loja), {
      headers: { Accept: 'application/json' },
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (config) {
        if (!config || !config.ativo) return;
        aplicar(config, plataforma);
      })
      .catch(function () {
        /* Sem rede não há banner. A loja segue funcionando. */
      });
  } catch (e) {
    /* Nada aqui pode virar erro na vitrine. */
  }

  /** `ios`, `android` ou `null` quando não é celular. */
  function detectar(ua) {
    if (/iPhone|iPod/i.test(ua)) return 'ios';
    // iPad moderno se apresenta como Mac; o toque é o que o entrega.
    if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return null;
  }

  function dispensadoRecentemente() {
    try {
      var ate = Number(window.localStorage.getItem(CHAVE) || 0);
      return Number.isFinite(ate) && ate > Date.now();
    } catch (e) {
      // Navegação privada bloqueia o storage. Melhor mostrar do que estourar.
      return false;
    }
  }

  function dispensar() {
    try {
      window.localStorage.setItem(CHAVE, String(Date.now() + DIAS * 86400000));
    } catch (e) {
      /* Sem storage, o banner volta na próxima página. Paciência. */
    }
  }

  function aplicar(config, plataforma) {
    /*
     * No iPhone, o Safari desenha o convite nativo a partir desta meta — e o
     * nativo é melhor do que qualquer tarja nossa: ele mostra o ícone, a nota
     * e o botão "abrir" quando o app já está instalado. Quando ela existe,
     * não desenhamos nada por cima.
     */
    if (plataforma === 'ios' && config.smartBanner) {
      var meta = document.createElement('meta');
      meta.name = 'apple-itunes-app';
      meta.content = config.smartBanner;
      (document.head || document.documentElement).appendChild(meta);
      return;
    }

    var destino = plataforma === 'ios' ? config.ios : config.android;
    if (!destino) return;

    desenhar(config.texto, destino);
  }

  function desenhar(texto, destino) {
    var raiz = document.createElement('div');
    raiz.id = 'storefy-banner';
    raiz.setAttribute('role', 'region');
    raiz.setAttribute('aria-label', 'Convite para baixar o aplicativo');
    raiz.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      'z-index:2147483000',
      'display:flex',
      'align-items:center',
      'gap:12px',
      'padding:12px 16px',
      // `env(safe-area-inset-bottom)`: sem isso a tarja fica embaixo da barra
      // de gestos do iPhone e o botão não recebe o toque.
      'padding-bottom:calc(12px + env(safe-area-inset-bottom, 0px))',
      'background:#111',
      'color:#fff',
      'font:500 14px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
      'box-shadow:0 -2px 12px rgba(0,0,0,.18)',
    ].join(';');

    var frase = document.createElement('span');
    frase.textContent = texto;
    frase.style.cssText = 'flex:1;min-width:0';

    var botao = document.createElement('a');
    botao.href = destino;
    botao.textContent = 'Baixar';
    botao.rel = 'noopener';
    botao.style.cssText =
      'flex:none;background:#fff;color:#111;border-radius:999px;padding:8px 16px;' +
      'text-decoration:none;font-weight:600';

    var fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.setAttribute('aria-label', 'Dispensar');
    fechar.textContent = '×';
    fechar.style.cssText =
      'flex:none;background:none;border:0;color:#fff;font-size:22px;line-height:1;' +
      'padding:4px 4px;cursor:pointer';
    fechar.addEventListener('click', function () {
      dispensar();
      if (raiz.parentNode) raiz.parentNode.removeChild(raiz);
    });

    raiz.appendChild(frase);
    raiz.appendChild(botao);
    raiz.appendChild(fechar);
    (document.body || document.documentElement).appendChild(raiz);
  }
})();
