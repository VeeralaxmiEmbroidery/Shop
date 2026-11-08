/*
 * Single-page shop UI with hash routes:
 *   #/                     catalog (?q=search&cat=category&sort=new|price-asc|price-desc|name)
 *   #/design/CODE          design detail
 *   #/cart                 cart
 *   #/checkout             details + UPI QR + UTR entry
 *   #/order/ORDER-ID       confirmation + WhatsApp message to shop
 *   #/download?o=ID&t=TOK  paid-order downloads
 *   #/demo-admin           demo-mode stand-in for the Google Sheet
 */
(function () {
  'use strict';

  var C = window.SHOP_CONFIG;
  var API = window.ShopAPI;
  var U = window.ShopUtil;
  var app = document.getElementById('app');

  var state = { designs: null, byCode: {}, shop: {}, loading: null, shown: C.PAGE_SIZE || 24 };

  // ---------- helpers ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    return C.CURRENCY_SYMBOL + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  /** Config merged with non-empty values from the sheet's Settings tab. */
  function shop() {
    var s = {};
    Object.keys(C).forEach(function (k) { s[k] = C[k]; });
    Object.keys(state.shop || {}).forEach(function (k) { if (state.shop[k]) s[k] = state.shop[k]; });
    return s;
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function setTitle(part) {
    document.title = (part ? part + ' | ' : '') + shop().SHOP_NAME;
  }
  function placeholder() { return 'assets/img/placeholder.svg'; }
  function loadingView(text) {
    app.innerHTML = '<div class="center-msg"><div class="spinner" aria-hidden="true"></div><p>' + esc(text || 'Loading...') + '</p></div>';
  }
  function errorView(err, retry) {
    app.innerHTML = '<div class="center-msg"><h2>Something went wrong</h2><p>' + esc(err && err.message || err) + '</p>' +
      (retry ? '<button class="btn" id="retry">Try again</button>' : '<a class="btn" href="#/">Back to designs</a>') + '</div>';
    if (retry) document.getElementById('retry').onclick = retry;
  }

  // ---------- cart ----------

  var CART_KEY = 'emb_cart';
  var Cart = {
    get: function () {
      try { var a = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    },
    set: function (a) { localStorage.setItem(CART_KEY, JSON.stringify(a)); updateBadge(); },
    has: function (code) { return Cart.get().indexOf(code) !== -1; },
    add: function (code) { var a = Cart.get(); if (a.indexOf(code) === -1) { a.push(code); Cart.set(a); } },
    remove: function (code) { Cart.set(Cart.get().filter(function (c) { return c !== code; })); },
    clear: function () { Cart.set([]); },
    /** Cart items that still exist in the catalog. */
    items: function () {
      return Cart.get().map(function (c) { return state.byCode[c]; }).filter(Boolean);
    }
  };
  function updateBadge() {
    var n = Cart.get().length;
    var b = document.getElementById('cart-count');
    b.textContent = n;
    b.classList.toggle('is-empty', n === 0);
  }
  window.addEventListener('storage', function (e) { if (e.key === CART_KEY) updateBadge(); });

  // ---------- catalog loading ----------

  function loadCatalog() {
    if (state.designs) return Promise.resolve(state.designs);
    if (state.loading) return state.loading;
    state.loading = API.catalog().then(function (data) {
      state.shop = data.shop || {};
      state.designs = (data.designs || []).map(function (d) {
        d.price = Number(d.price) || 0;
        d.images = (d.images || []).filter(Boolean);
        d.formats = d.formats && d.formats.length ? d.formats : ['DST'];
        return d;
      });
      state.byCode = {};
      state.designs.forEach(function (d) { state.byCode[d.code] = d; });
      // Drop cart entries for designs that were removed.
      var valid = Cart.get().filter(function (c) { return state.byCode[c]; });
      if (valid.length !== Cart.get().length) Cart.set(valid);
      applyShopChrome();
      return state.designs;
    }).catch(function (e) { state.loading = null; throw e; });
    return state.loading;
  }

  function applyShopChrome() {
    var s = shop();
    document.getElementById('shop-name').textContent = s.SHOP_NAME;
    document.getElementById('footer-name').textContent = s.SHOP_NAME;
    var wa = document.getElementById('footer-wa');
    wa.href = U.waLink(s.WHATSAPP_NUMBER, 'Hello ' + s.SHOP_NAME + ', I have a question about your designs.');
    document.getElementById('demo-banner').hidden = !API.isDemo;
    setTitle();
  }

  // ---------- router ----------

  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/';
    var qi = h.indexOf('?');
    var path = qi === -1 ? h : h.slice(0, qi);
    var qs = qi === -1 ? '' : h.slice(qi + 1);
    return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
  }

  var lastRoute = '';
  function route() {
    var r = parseHash();
    var key = r.parts[0] || '';
    document.getElementById('toast').classList.remove('show');
    // Catalog filter changes replace the query only; don't reset scroll for those.
    if (!(key === '' && lastRoute === '')) window.scrollTo(0, 0);
    lastRoute = key;
    switch (key) {
      case '': return withCatalog(function () { renderCatalog(r.query); });
      case 'design': return withCatalog(function () { renderDesign(r.parts[1] || ''); });
      case 'cart': return withCatalog(renderCart);
      case 'checkout': return withCatalog(renderCheckout);
      case 'order': return withCatalog(function () { renderOrderDone(r.parts[1] || ''); });
      case 'download': return renderDownload(r.query.get('o') || '', r.query.get('t') || '');
      case 'demo-admin': return withCatalog(renderDemoAdmin);
      default:
        app.innerHTML = '<div class="center-msg"><h2>Page not found</h2><a class="btn" href="#/">Browse designs</a></div>';
    }
  }
  function withCatalog(fn) {
    if (!state.designs) loadingView('Loading designs...');
    loadCatalog().then(fn).catch(function (e) { errorView(e, route); });
  }

  // ---------- catalog ----------

  function card(d) {
    var img = d.images[0] || placeholder();
    var inCart = Cart.has(d.code);
    return '<article class="card">' +
      '<a class="card-img" href="#/design/' + encodeURIComponent(d.code) + '">' +
      '<img src="' + esc(img) + '" alt="' + esc(d.name) + '" loading="lazy" onerror="this.src=\'' + placeholder() + '\'"></a>' +
      '<div class="card-body">' +
      '<div class="code">' + esc(d.code) + (d.category ? ' · ' + esc(d.category) : '') + '</div>' +
      '<h3><a href="#/design/' + encodeURIComponent(d.code) + '">' + esc(d.name) + '</a></h3>' +
      '<div class="card-foot"><span class="price">' + money(d.price) + '</span>' +
      '<button class="btn btn-sm ' + (inCart ? 'btn-ghost' : '') + '" data-cart="' + esc(d.code) + '">' +
      (inCart ? 'In cart ✓' : 'Add to cart') + '</button></div>' +
      '</div></article>';
  }

  function renderCatalog(query) {
    setTitle();
    var s = shop();
    var cats = [];
    state.designs.forEach(function (d) { if (d.category && cats.indexOf(d.category) === -1) cats.push(d.category); });
    cats.sort();
    var q = query.get('q') || '';
    var cat = query.get('cat') || '';
    var sort = query.get('sort') || 'new';

    app.innerHTML =
      '<section class="hero"><h1>' + esc(s.SHOP_NAME) + '</h1><p>' + esc(s.TAGLINE || '') + '</p></section>' +
      '<section class="filters">' +
      '<input type="search" id="f-q" placeholder="Search by name or code" value="' + esc(q) + '" aria-label="Search designs">' +
      '<select id="f-cat" aria-label="Category"><option value="">All categories</option>' +
      cats.map(function (c) { return '<option' + (c === cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '</select>' +
      '<select id="f-sort" aria-label="Sort">' +
      [['new', 'Newest'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['name', 'Name']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sort ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></section>' +
      '<p class="muted" id="result-count"></p>' +
      '<section class="grid" id="grid"></section>' +
      '<div class="center"><button class="btn btn-ghost" id="more" hidden>Show more</button></div>';

    var fq = document.getElementById('f-q');
    var fc = document.getElementById('f-cat');
    var fs = document.getElementById('f-sort');
    var debounce;
    function sync() {
      var p = new URLSearchParams();
      if (fq.value.trim()) p.set('q', fq.value.trim());
      if (fc.value) p.set('cat', fc.value);
      if (fs.value !== 'new') p.set('sort', fs.value);
      var qs = p.toString();
      history.replaceState(null, '', '#/' + (qs ? '?' + qs : ''));
      state.shown = C.PAGE_SIZE || 24;
      drawGrid(fq.value, fc.value, fs.value);
    }
    fq.addEventListener('input', function () { clearTimeout(debounce); debounce = setTimeout(sync, 200); });
    fc.addEventListener('change', sync);
    fs.addEventListener('change', sync);
    document.getElementById('more').onclick = function () {
      state.shown += C.PAGE_SIZE || 24;
      drawGrid(fq.value, fc.value, fs.value);
    };
    drawGrid(q, cat, sort);
  }

  function drawGrid(q, cat, sort) {
    var needle = q.trim().toLowerCase();
    var list = state.designs.filter(function (d) {
      if (cat && d.category !== cat) return false;
      if (!needle) return true;
      return (d.code + ' ' + d.name + ' ' + (d.category || '') + ' ' + (d.description || '')).toLowerCase().indexOf(needle) !== -1;
    });
    if (sort === 'price-asc') list.sort(function (a, b) { return a.price - b.price; });
    else if (sort === 'price-desc') list.sort(function (a, b) { return b.price - a.price; });
    else if (sort === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name); });

    var grid = document.getElementById('grid');
    var shown = list.slice(0, state.shown);
    grid.innerHTML = shown.length ? shown.map(card).join('') :
      '<p class="empty">No designs match your search.</p>';
    document.getElementById('result-count').textContent = list.length + ' design' + (list.length === 1 ? '' : 's');
    document.getElementById('more').hidden = list.length <= state.shown;
  }

  // Add-to-cart buttons anywhere in the page.
  app.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cart]');
    if (!btn) return;
    var code = btn.getAttribute('data-cart');
    if (Cart.has(code)) { location.hash = '#/cart'; return; }
    Cart.add(code);
    btn.textContent = 'In cart ✓';
    btn.classList.add('btn-ghost');
    toast('Added ' + code + ' to cart');
  });

  // ---------- design detail ----------

  function renderDesign(code) {
    var d = state.byCode[code];
    if (!d) {
      app.innerHTML = '<div class="center-msg"><h2>Design not found</h2><p>' + esc(code) + ' is not in the catalog.</p><a class="btn" href="#/">Browse designs</a></div>';
      return;
    }
    setTitle(d.name);
    var imgs = d.images.length ? d.images : [placeholder()];
    var inCart = Cart.has(d.code);
    var specs = [['Design code', d.code], ['Category', d.category], ['Size', d.size], ['Stitches', d.stitches],
      ['Colours', d.colors], ['File format', d.formats.join(', ')]].filter(function (r) { return r[1]; });

    app.innerHTML =
      '<a href="#/" class="back">← All designs</a>' +
      '<section class="detail">' +
      '<div class="gallery"><div class="main-img"><img id="main-img" src="' + esc(imgs[0]) + '" alt="' + esc(d.name) + '" onerror="this.src=\'' + placeholder() + '\'"></div>' +
      (imgs.length > 1 ? '<div class="thumbs">' + imgs.map(function (src, i) {
        return '<button class="thumb' + (i === 0 ? ' active' : '') + '" data-src="' + esc(src) + '" aria-label="Image ' + (i + 1) + '"><img src="' + esc(src) + '" alt="" loading="lazy"></button>';
      }).join('') + '</div>' : '') + '</div>' +
      '<div class="info"><div class="code">' + esc(d.code) + '</div><h1>' + esc(d.name) + '</h1>' +
      '<div class="price big">' + money(d.price) + '</div>' +
      (d.description ? '<p class="desc">' + esc(d.description) + '</p>' : '') +
      '<table class="specs">' + specs.map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<div class="actions"><button class="btn ' + (inCart ? 'btn-ghost' : '') + '" data-cart="' + esc(d.code) + '">' + (inCart ? 'In cart ✓' : 'Add to cart') + '</button>' +
      '<button class="btn btn-accent" id="buy-now">Buy now</button></div>' +
      '<p class="muted small">Digital download. You get the file after we confirm your UPI payment. Preview images are for display only; stitched results vary by fabric and thread.</p>' +
      '</div></section>';

    var main = document.getElementById('main-img');
    app.querySelectorAll('.thumb').forEach(function (t) {
      t.onclick = function () {
        main.src = t.getAttribute('data-src');
        app.querySelectorAll('.thumb').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
      };
    });
    document.getElementById('buy-now').onclick = function () { Cart.add(d.code); location.hash = '#/checkout'; };
  }

  // ---------- cart page ----------

  function renderCart() {
    setTitle('Cart');
    var items = Cart.items();
    if (!items.length) {
      app.innerHTML = '<div class="center-msg"><h2>Your cart is empty</h2><a class="btn" href="#/">Browse designs</a></div>';
      return;
    }
    var total = items.reduce(function (s, d) { return s + d.price; }, 0);
    app.innerHTML = '<h1>Cart</h1><div class="cart-list">' + items.map(function (d) {
      return '<div class="cart-row"><img src="' + esc(d.images[0] || placeholder()) + '" alt="" onerror="this.src=\'' + placeholder() + '\'">' +
        '<div class="grow"><a href="#/design/' + encodeURIComponent(d.code) + '"><strong>' + esc(d.name) + '</strong></a><div class="code">' + esc(d.code) + '</div></div>' +
        '<div class="price">' + money(d.price) + '</div>' +
        '<button class="icon-btn" data-remove="' + esc(d.code) + '" aria-label="Remove ' + esc(d.name) + '">✕</button></div>';
    }).join('') + '</div>' +
      '<div class="cart-total"><span>Total (' + items.length + ' design' + (items.length === 1 ? '' : 's') + ')</span><strong>' + money(total) + '</strong></div>' +
      '<div class="actions right"><a class="btn btn-ghost" href="#/">Add more designs</a><a class="btn btn-accent" href="#/checkout">Checkout</a></div>';
    app.querySelectorAll('[data-remove]').forEach(function (b) {
      b.onclick = function () { Cart.remove(b.getAttribute('data-remove')); renderCart(); };
    });
  }

  // ---------- checkout ----------

  function cartSignature(items) { return items.map(function (d) { return d.code + ':' + d.price; }).sort().join(','); }

  /** Order reference used in the UPI note; stable while the cart is unchanged. */
  function orderRef(items) {
    var sig = cartSignature(items);
    try {
      var saved = JSON.parse(sessionStorage.getItem('emb_ref') || 'null');
      if (saved && saved.sig === sig) return saved.ref;
    } catch (e) { /* ignore */ }
    var ref = U.makeOrderRef(shop().ORDER_PREFIX);
    sessionStorage.setItem('emb_ref', JSON.stringify({ sig: sig, ref: ref }));
    return ref;
  }

  function renderCheckout() {
    setTitle('Checkout');
    var items = Cart.items();
    if (!items.length) {
      app.innerHTML = '<div class="center-msg"><h2>Your cart is empty</h2><a class="btn" href="#/">Browse designs</a></div>';
      return;
    }
    var s = shop();
    var total = items.reduce(function (sum, d) { return sum + d.price; }, 0);
    var ref = orderRef(items);
    var upi = U.upiLink({ upiId: s.UPI_ID, payee: s.UPI_PAYEE_NAME || s.SHOP_NAME, amount: total, note: ref });
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('emb_customer') || '{}'); } catch (e) { /* ignore */ }

    app.innerHTML =
      '<a href="#/cart" class="back">← Back to cart</a><h1>Checkout</h1>' +
      '<div class="checkout">' +
      '<form id="co-form" class="steps" novalidate>' +
      '<section class="step"><h2><span class="num">1</span> Your details</h2>' +
      field('name', 'Full name', 'text', saved.name, 'autocomplete="name" maxlength="80" required') +
      field('phone', 'WhatsApp number', 'tel', saved.phone, 'autocomplete="tel" inputmode="numeric" placeholder="10-digit mobile number" required',
        'We send your download link to this number on WhatsApp.') +
      field('email', 'Email (optional)', 'email', saved.email, 'autocomplete="email" maxlength="120"') +
      '<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '</section>' +

      '<section class="step"><h2><span class="num">2</span> Pay ' + money(total) + ' by UPI</h2>' +
      '<div class="pay-box"><div class="qr" id="qr" aria-label="UPI QR code"></div>' +
      '<div class="pay-info"><p>Scan with any UPI app (GPay, PhonePe, Paytm, BHIM).</p>' +
      '<p class="amount">' + money(total) + '</p>' +
      '<p>UPI ID: <strong id="upi-id">' + esc(s.UPI_ID) + '</strong> <button type="button" class="link-btn" id="copy-upi">Copy</button></p>' +
      '<p>Payee: ' + esc(s.UPI_PAYEE_NAME || s.SHOP_NAME) + '</p>' +
      '<p>Reference: <strong>' + esc(ref) + '</strong></p>' +
      '<a class="btn btn-sm mobile-only" href="' + esc(upi) + '">Open UPI app</a></div></div>' +
      '<p class="muted small">Check the amount is exactly ' + money(total) + ' before you pay. If the QR does not scan, pay to the UPI ID above and add the reference in the note.</p>' +
      '</section>' +

      '<section class="step"><h2><span class="num">3</span> Enter UTR number</h2>' +
      '<p class="muted small">After paying, open the payment in your UPI app and copy the 12-digit <strong>UTR</strong> (also called UPI Ref No. or UPI transaction ID).</p>' +
      field('utr', 'UTR / UPI reference number', 'text', '', 'inputmode="numeric" maxlength="14" placeholder="12 digits" autocomplete="off" required') +
      '<div class="form-error" id="form-error" role="alert" hidden></div>' +
      '<button class="btn btn-accent btn-block" type="submit" id="submit">Place order</button>' +
      '</section></form>' +

      '<aside class="summary"><h2>Order summary</h2>' + items.map(function (d) {
        return '<div class="sum-row"><span>' + esc(d.name) + ' <span class="code">' + esc(d.code) + '</span></span><span>' + money(d.price) + '</span></div>';
      }).join('') + '<div class="sum-row total"><span>Total</span><span>' + money(total) + '</span></div></aside>' +
      '</div>';

    drawQr(upi);
    document.getElementById('copy-upi').onclick = function () { copyText(s.UPI_ID); };

    var form = document.getElementById('co-form');
    form.addEventListener('input', function (e) {
      var name = e.target.getAttribute('name');
      var err = name && form.querySelector('[data-err="' + name + '"]');
      if (err && err.textContent) { err.textContent = ''; e.target.setAttribute('aria-invalid', 'false'); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var body = {
        ref: ref, name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), utr: fd.get('utr'),
        website: fd.get('website'), items: items.map(function (d) { return d.code; }),
        clientTotal: total
      };
      var v = U.validateOrder(body);
      showErrors(form, v.errors);
      if (Object.keys(v.errors).length) return;
      localStorage.setItem('emb_customer', JSON.stringify({ name: v.clean.name, phone: fd.get('phone'), email: v.clean.email }));

      var btn = document.getElementById('submit');
      btn.disabled = true;
      btn.textContent = 'Placing order...';
      body.name = v.clean.name; body.phone = v.clean.phone; body.email = v.clean.email; body.utr = v.clean.utr;
      API.createOrder(body).then(function (res) {
        var order = { orderId: res.orderId, total: res.total, items: res.items, utr: v.clean.utr, name: v.clean.name };
        sessionStorage.setItem('emb_last_order', JSON.stringify(order));
        sessionStorage.removeItem('emb_ref');
        Cart.clear();
        location.hash = '#/order/' + encodeURIComponent(res.orderId);
      }).catch(function (err) {
        var box = document.getElementById('form-error');
        box.textContent = err.isApi ? err.message : 'Could not place the order. Check your internet connection and try again.';
        box.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Place order';
      });
    });
  }

  function field(name, label, type, value, attrs, hint) {
    return '<label class="field"><span>' + esc(label) + '</span>' +
      '<input name="' + name + '" type="' + type + '" value="' + esc(value || '') + '" ' + (attrs || '') + '>' +
      (hint ? '<small class="hint">' + esc(hint) + '</small>' : '') +
      '<small class="err" data-err="' + name + '"></small></label>';
  }
  function showErrors(form, errors) {
    form.querySelectorAll('[data-err]').forEach(function (el) {
      var k = el.getAttribute('data-err');
      el.textContent = errors[k] || '';
      var input = form.querySelector('[name="' + k + '"]');
      if (input) input.setAttribute('aria-invalid', errors[k] ? 'true' : 'false');
    });
    var box = document.getElementById('form-error');
    box.hidden = !errors.items;
    box.textContent = errors.items || '';
    var first = Object.keys(errors).filter(function (k) { return k !== 'items'; })[0];
    if (first) form.querySelector('[name="' + first + '"]').focus();
  }
  function drawQr(text) {
    var el = document.getElementById('qr');
    if (typeof window.qrcode !== 'function') { el.innerHTML = '<p class="muted small">QR unavailable. Pay to the UPI ID.</p>'; return; }
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, function () { toast(text); });
    } else { toast(text); }
  }

  // ---------- order confirmation ----------

  function renderOrderDone(orderId) {
    setTitle('Order placed');
    var s = shop();
    var order = null;
    try { order = JSON.parse(sessionStorage.getItem('emb_last_order') || 'null'); } catch (e) { /* ignore */ }
    if (!order || order.orderId !== orderId) {
      app.innerHTML = '<div class="center-msg"><h2>Order ' + esc(orderId) + '</h2>' +
        '<p>We will send your download link on WhatsApp after verifying your payment.</p>' +
        '<a class="btn btn-wa" href="' + esc(U.waLink(s.WHATSAPP_NUMBER, 'Hello ' + s.SHOP_NAME + ', I placed order ' + orderId + '.')) + '" target="_blank" rel="noopener">Message us on WhatsApp</a></div>';
      return;
    }
    var wa = U.waLink(s.WHATSAPP_NUMBER, U.orderMessage(s.SHOP_NAME, order));
    app.innerHTML =
      '<section class="done"><div class="tick" aria-hidden="true">✓</div><h1>Order placed</h1>' +
      '<p>Order ID <strong>' + esc(order.orderId) + '</strong> · ' + money(order.total) + ' · UTR ' + esc(order.utr) + '</p>' +
      '<div class="callout"><strong>One last step:</strong> send us your order on WhatsApp so we can verify it quickly.</div>' +
      '<a class="btn btn-wa btn-block" href="' + esc(wa) + '" target="_blank" rel="noopener">Send order on WhatsApp</a>' +
      '<h2>What happens next</h2><ol class="next"><li>We match your UTR with our bank statement ' + esc(C.VERIFY_TIME_TEXT) + '.</li>' +
      '<li>You get a private download link on WhatsApp.</li><li>Open the link and download your DST files.</li></ol>' +
      '<div class="sum-box">' + order.items.map(function (it) {
        return '<div class="sum-row"><span>' + esc(it.name) + ' <span class="code">' + esc(it.code) + '</span></span><span>' + money(it.price) + '</span></div>';
      }).join('') + '</div>' +
      (API.isDemo ? '<p class="demo-note">Demo: open the <a href="#/demo-admin">demo admin</a> to mark this order as paid and get the customer download link.</p>' : '') +
      '<a class="btn btn-ghost" href="#/">Continue browsing</a></section>';
  }

  // ---------- downloads ----------

  function renderDownload(o, t) {
    setTitle('Download');
    if (!o || !t) {
      app.innerHTML = '<div class="center-msg"><h2>Download link incomplete</h2><p>Please open the full link we sent you on WhatsApp.</p></div>';
      return;
    }
    loadingView('Checking your order...');
    // Shop name for the header even if catalog isn't loaded (ignore errors).
    loadCatalog().catch(function () { /* not needed here */ });
    API.order(o, t).then(function (res) {
      var ord = res.order;
      var count = ord.items.reduce(function (n, it) { return n + it.files.length; }, 0);
      app.innerHTML =
        '<section class="downloads"><h1>Your designs</h1>' +
        '<p>Order <strong>' + esc(ord.id) + '</strong> for ' + esc(ord.name) + ' · ' + money(ord.total) + '</p>' +
        (ord.expiresAt ? '<p class="muted small">Link valid until ' + esc(new Date(ord.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })) + '. Please save your files.</p>' : '') +
        (API.isDemo ? '<p class="demo-note">Demo mode: files are small text placeholders.</p>' : '') +
        '<div class="dl-list">' + ord.items.map(function (it) {
          return '<div class="dl-item">' + (it.image ? '<img src="' + esc(it.image) + '" alt="" onerror="this.remove()">' : '') +
            '<div class="grow"><strong>' + esc(it.name) + '</strong><div class="code">' + esc(it.code) + '</div></div>' +
            '<div class="dl-files">' + (it.files.length ? it.files.map(function (f) {
              return '<button class="btn btn-sm" data-file="' + esc(f.id) + '" data-name="' + esc(f.name) + '">⬇ ' + esc(f.name) + '</button>';
            }).join('') : '<span class="muted small">File being prepared. Please message us.</span>') + '</div></div>';
        }).join('') + '</div>' +
        (count > 1 ? '<button class="btn btn-accent" id="dl-all">Download all (' + count + ' files)</button>' : '') +
        '<p class="muted small">Problems downloading? <a href="' + esc(U.waLink(shop().WHATSAPP_NUMBER, 'Hello, I need help downloading order ' + ord.id + '.')) + '" target="_blank" rel="noopener">Message us on WhatsApp</a>.</p>' +
        '</section>';

      var buttons = Array.prototype.slice.call(app.querySelectorAll('[data-file]'));
      buttons.forEach(function (b) { b.onclick = function () { downloadOne(o, t, b); }; });
      var all = document.getElementById('dl-all');
      if (all) {
        all.onclick = function () {
          all.disabled = true;
          buttons.reduce(function (p, b) { return p.then(function () { return downloadOne(o, t, b); }); }, Promise.resolve())
            .then(function () { all.disabled = false; });
        };
      }
    }).catch(function (err) {
      app.innerHTML = '<div class="center-msg"><h2>Cannot open downloads</h2><p>' + esc(err.isApi ? err.message : 'Network error. Please try again.') + '</p>' +
        '<a class="btn btn-wa" href="' + esc(U.waLink(shop().WHATSAPP_NUMBER, 'Hello, my download link for order ' + o + ' is not working.')) + '" target="_blank" rel="noopener">Message us on WhatsApp</a></div>';
    });
  }

  function downloadOne(o, t, btn) {
    var label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Downloading...';
    return API.file(o, t, btn.getAttribute('data-file')).then(function (res) {
      var blob = U.base64ToBlob(res.file.data, res.file.mimeType);
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = res.file.name || btn.getAttribute('data-name');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      btn.innerHTML = '✓ ' + esc(a.download);
      btn.classList.add('btn-ghost');
      btn.disabled = false;
    }).catch(function (err) {
      btn.innerHTML = label;
      btn.disabled = false;
      toast(err.isApi ? err.message : 'Download failed. Please try again.');
    });
  }

  // ---------- demo admin ----------

  function renderDemoAdmin() {
    setTitle('Demo admin');
    if (!API.isDemo) {
      app.innerHTML = '<div class="center-msg"><h2>Not available</h2><p>The live shop is managed in the Google Sheet.</p></div>';
      return;
    }
    var s = shop();
    var orders = API.demo.listOrders();
    var siteUrl = location.href.split('#')[0];
    app.innerHTML =
      '<h1>Demo admin</h1>' +
      '<p class="muted">This page imitates the <strong>Orders</strong> tab of the Google Sheet. Tick <em>Paid</em> after checking the UTR in your bank app, then click <em>Send</em> to open WhatsApp with the download link for the customer.</p>' +
      (orders.length ? '<div class="table-wrap"><table class="admin"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>UTR</th><th>Paid</th><th>Send</th></tr></thead><tbody>' +
        orders.map(function (o) {
          var link = o.paid ? U.downloadLink(siteUrl, o.orderId, o.token) : '';
          return '<tr><td><strong>' + esc(o.orderId) + '</strong><div class="muted small">' + esc(new Date(o.created).toLocaleString('en-IN')) + '</div></td>' +
            '<td>' + esc(o.name) + '<div class="muted small">+' + esc(o.phone) + '</div></td>' +
            '<td>' + o.items.map(function (i) { return esc(i.code); }).join(', ') + '</td>' +
            '<td>' + money(o.total) + '</td><td><code>' + esc(o.utr) + '</code></td>' +
            '<td><input type="checkbox" data-paid="' + esc(o.orderId) + '"' + (o.paid ? ' checked' : '') + ' aria-label="Paid"></td>' +
            '<td>' + (o.paid ? '<a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="' + esc(U.waLink(o.phone, U.paidMessage(s.SHOP_NAME, o, link, 30))) + '">Send ▶</a>' +
              ' <a class="small" href="' + esc(link) + '">open link</a>' : '<span class="muted small">tick Paid</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<button class="btn btn-ghost" id="reset">Clear demo orders</button>'
        : '<div class="center-msg"><p>No demo orders yet. <a href="#/">Add a design to the cart</a> and check out with any 12-digit UTR, e.g. 123456789012.</p></div>');

    app.querySelectorAll('[data-paid]').forEach(function (cb) {
      cb.onchange = function () { API.demo.setPaid(cb.getAttribute('data-paid'), cb.checked); renderDemoAdmin(); };
    });
    var reset = document.getElementById('reset');
    if (reset) reset.onclick = function () {
      if (confirm('Delete all demo orders stored in this browser?')) { API.demo.reset(); renderDemoAdmin(); }
    };
  }

  // ---------- boot ----------

  document.getElementById('year').textContent = new Date().getFullYear();
  applyShopChrome();
  updateBadge();
  window.addEventListener('hashchange', route);
  route();
})();
