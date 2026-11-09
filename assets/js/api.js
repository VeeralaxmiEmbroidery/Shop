/*
 * Data layer. Two interchangeable backends with the same methods:
 *   - Live: Google Apps Script web app (config.API_URL)
 *   - Demo: built-in sample designs + orders stored in localStorage
 *
 * Methods: catalog(), createOrder(body), order(orderId, token), file(orderId, token, fileId)
 * Demo-only: demo.listOrders(), demo.setPaid(orderId, paid), demo.reset()
 */
(function () {
  'use strict';
  var C = window.SHOP_CONFIG;

  // ---------- Shared helpers (used by the UI and the demo backend) ----------

  var Util = {
    normalizePhone: function (raw) {
      var d = String(raw || '').replace(/\D/g, '');
      if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
      if (d.length === 10) d = '91' + d;
      if (/^91[6-9]\d{9}$/.test(d)) return d;
      return null;
    },
    isValidUtr: function (utr) {
      return /^\d{12}$/.test(String(utr || '').trim());
    },
    isValidEmail: function (e) {
      return !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
    },
    /** Validates checkout input. Returns {errors:{field:msg}, clean:{...}} */
    validateOrder: function (body) {
      var errors = {};
      var name = String(body.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 80) errors.name = 'Please enter your name.';
      var phone = Util.normalizePhone(body.phone);
      if (!phone) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
      var email = String(body.email || '').trim();
      if (!Util.isValidEmail(email) || email.length > 120) errors.email = 'Enter a valid email or leave it blank.';
      var utr = String(body.utr || '').replace(/\s/g, '');
      if (utr ? !Util.isValidUtr(utr) : C.ASK_UTR === true) errors.utr = 'The UTR / UPI reference number has 12 digits.';
      var items = Array.isArray(body.items) ? body.items.map(String) : [];
      items = items.filter(function (c, i) { return c && items.indexOf(c) === i; });
      if (!items.length) errors.items = 'Your cart is empty.';
      if (items.length > 50) errors.items = 'Please order at most 50 designs at a time.';
      return { errors: errors, clean: { name: name, phone: phone, email: email, utr: utr, items: items } };
    },
    makeOrderRef: function (prefix) {
      var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      var out = '';
      var rnd = new Uint32Array(6);
      (window.crypto || window.msCrypto).getRandomValues(rnd);
      for (var i = 0; i < 6; i++) out += chars[rnd[i] % chars.length];
      return (prefix || 'EMB') + '-' + out;
    },
    upiLink: function (opts) {
      var p = [
        'pa=' + encodeURIComponent(String(opts.upiId).trim()).replace(/%40/g, '@'),
        'pn=' + encodeURIComponent(opts.payee),
        'am=' + Number(opts.amount).toFixed(2),
        'cu=INR',
        'tn=' + encodeURIComponent(opts.note || '')
      ];
      return 'upi://pay?' + p.join('&');
    },
    waLink: function (number, text) {
      return 'https://wa.me/' + String(number || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(text);
    },
    rupees: function (n) {
      return '\u20B9' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    },
    /** Message the customer sends to the shop after placing an order. */
    orderMessage: function (shopName, order) {
      var lines = ['Hello ' + shopName + ', I have placed an order.', '', 'Order ID: ' + order.orderId, ''];
      order.items.forEach(function (it, i) {
        lines.push((i + 1) + '. ' + it.code + ' - ' + it.name + ' (' + Util.rupees(it.price) + ')');
      });
      lines.push('', 'Total paid: ' + Util.rupees(order.total));
      lines.push(order.utr ? 'UPI UTR: ' + order.utr : 'Payment screenshot: sending now');
      lines.push('Name: ' + order.name, 'Please verify and send my download link. Thank you!');
      return lines.join('\n');
    },
    /** Message the shop sends to the customer once paid (mirrors Apps Script). */
    paidMessage: function (shopName, order, link, days) {
      var lines = ['Hi ' + order.name + ', thank you for your order ' + order.orderId + ' from ' + shopName + '.',
        'We have received your payment of ' + Util.rupees(order.total) + '.', '',
        'Download your designs here:', link];
      if (days > 0) lines.push('', 'This link is valid for ' + days + ' days.');
      return lines.join('\n');
    },
    downloadLink: function (siteUrl, orderId, token) {
      return siteUrl + '#/download?o=' + encodeURIComponent(orderId) + '&t=' + encodeURIComponent(token);
    },
    base64ToBlob: function (b64, type) {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: type || 'application/octet-stream' });
    }
  };

  function ApiError(message) {
    var e = new Error(message);
    e.isApi = true;
    return e;
  }

  // ---------- Live backend (Google Apps Script) ----------

  var Live = {
    _get: function (params) {
      var url = C.API_URL + '?' + new URLSearchParams(params).toString();
      return fetch(url, { method: 'GET', redirect: 'follow' }).then(handle);
    },
    _post: function (body) {
      // text/plain avoids a CORS preflight, which Apps Script does not answer.
      return fetch(C.API_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      }).then(handle);
    },
    catalog: function () {
      var KEY = 'emb_catalog_cache';
      try {
        var cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (cached && Date.now() - cached.at < 5 * 60 * 1000) return Promise.resolve(cached.data);
      } catch (e) { /* ignore */ }
      return Live._get({ action: 'catalog' }).then(function (data) {
        try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (e) { /* quota */ }
        return data;
      });
    },
    createOrder: function (body) {
      body.action = 'createOrder';
      return Live._post(body);
    },
    order: function (o, t) { return Live._get({ action: 'order', o: o, t: t }); },
    file: function (o, t, f) { return Live._get({ action: 'file', o: o, t: t, f: f }); }
  };

  function handle(res) {
    if (!res.ok) throw ApiError('Could not reach the shop server (HTTP ' + res.status + '). Please try again.');
    return res.text().then(function (txt) {
      var data;
      try { data = JSON.parse(txt); } catch (e) {
        throw ApiError('The shop server sent an unexpected reply. If you are the owner, check the web app deployment access is "Anyone".');
      }
      if (!data.ok) throw ApiError(data.error || 'Request failed.');
      return data;
    });
  }

  // ---------- Demo backend ----------

  var DEMO_KEY = 'emb_demo_orders';
  var Demo = {
    _orders: function () {
      try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; }
    },
    _save: function (list) { localStorage.setItem(DEMO_KEY, JSON.stringify(list)); },
    _designs: function () { return (window.DEMO_DESIGNS || []).slice(); },
    _delay: function (v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 350); }); },
    _find: function (o, t) {
      var ord = Demo._orders().filter(function (x) { return x.orderId === o; })[0];
      if (!ord || !t || ord.token !== t) throw ApiError('This download link is not valid. Please use the exact link we sent on WhatsApp.');
      if (!ord.paid) throw ApiError('Payment for this order is not confirmed yet.');
      return ord;
    },
    catalog: function () {
      return Demo._delay({ ok: true, shop: {}, designs: Demo._designs() });
    },
    createOrder: function (body) {
      var v = Util.validateOrder(body);
      var keys = Object.keys(v.errors);
      if (keys.length) return Promise.reject(ApiError(v.errors[keys[0]]));
      var clean = v.clean;
      var byCode = {};
      Demo._designs().forEach(function (d) { byCode[d.code] = d; });
      var items = [];
      for (var i = 0; i < clean.items.length; i++) {
        var d = byCode[clean.items[i]];
        if (!d) return Promise.reject(ApiError('Design ' + clean.items[i] + ' is no longer available.'));
        items.push({ code: d.code, name: d.name, price: Number(d.price) });
      }
      var orders = Demo._orders();
      if (clean.utr && orders.some(function (o) { return o.utr === clean.utr; })) {
        return Promise.reject(ApiError('This UTR has already been used for another order. Please check the number.'));
      }
      var id = /^[A-Z]{2,8}-[A-Z0-9]{6}$/.test(body.ref || '') && !orders.some(function (o) { return o.orderId === body.ref; })
        ? body.ref : Util.makeOrderRef(C.ORDER_PREFIX);
      var total = items.reduce(function (s, it) { return s + it.price; }, 0);
      var order = {
        orderId: id, created: new Date().toISOString(), name: clean.name, phone: clean.phone, email: clean.email,
        utr: clean.utr, items: items, total: total, paid: false, token: '', paidAt: ''
      };
      orders.unshift(order);
      Demo._save(orders);
      return Demo._delay({ ok: true, orderId: id, total: total, items: items });
    },
    order: function (o, t) {
      try {
        var ord = Demo._find(o, t);
        var byCode = {};
        Demo._designs().forEach(function (d) { byCode[d.code] = d; });
        return Demo._delay({
          ok: true,
          order: {
            id: ord.orderId, name: ord.name, total: ord.total, paidAt: ord.paidAt, expiresAt: '',
            items: ord.items.map(function (it) {
              var d = byCode[it.code] || {};
              return {
                code: it.code, name: it.name, image: (d.images || [])[0] || '',
                files: [{ id: 'demo:' + it.code, name: it.code + '.dst', size: 0 }]
              };
            })
          }
        });
      } catch (e) { return Promise.reject(e); }
    },
    file: function (o, t, f) {
      try {
        Demo._find(o, t);
        var code = String(f).replace(/^demo:/, '');
        var text = 'DEMO FILE for design ' + code + '.\r\nIn the live shop this is the real DST file from Google Drive.\r\n';
        return Demo._delay({ ok: true, file: { name: code + '-DEMO.txt', mimeType: 'text/plain', data: btoa(text) } });
      } catch (e) { return Promise.reject(e); }
    },
    demo: {
      listOrders: function () { return Demo._orders(); },
      setPaid: function (orderId, paid) {
        var list = Demo._orders();
        list.forEach(function (o) {
          if (o.orderId !== orderId) return;
          o.paid = !!paid;
          if (paid) {
            var a = new Uint32Array(4);
            crypto.getRandomValues(a);
            o.token = o.token || Array.prototype.map.call(a, function (n) { return n.toString(16).padStart(8, '0'); }).join('');
            o.paidAt = o.paidAt || new Date().toISOString();
          } else {
            o.token = ''; o.paidAt = '';
          }
        });
        Demo._save(list);
        return list.filter(function (o) { return o.orderId === orderId; })[0];
      },
      reset: function () { localStorage.removeItem(DEMO_KEY); }
    }
  };

  var isDemo = !!C.DEMO_MODE || !C.API_URL;
  window.ShopAPI = isDemo ? Demo : Live;
  window.ShopAPI.isDemo = isDemo;
  window.ShopUtil = Util;
})();
