/**
 * CSP-safe compatibility layer for legacy landing action attributes.
 *
 * The production policy intentionally excludes unsafe-inline, so browsers
 * refuse onclick/onsubmit attributes. This bridge removes those attributes and
 * invokes only named functions with simple literal arguments. It never evals
 * page text and supports dynamically rendered deal/video controls.
 */
(function () {
  'use strict';

  function splitStatements(source) {
    var out = [], current = '', quote = '', depth = 0;
    for (var i = 0; i < source.length; i++) {
      var ch = source[i];
      if (quote) {
        current += ch;
        if (ch === quote && source[i - 1] !== '\\') quote = '';
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ';' && depth === 0) { if (current.trim()) out.push(current.trim()); current = ''; }
      else current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out;
  }

  function parseArgs(source, event, element) {
    if (!source.trim()) return [];
    var args = [], current = '', quote = '', depth = 0;
    function push(value) {
      value = value.trim();
      if (value === 'event') args.push(event);
      else if (value === 'this') args.push(element);
      else if (/^-?\d+(?:\.\d+)?$/.test(value)) args.push(Number(value));
      else if (value === 'true') args.push(true);
      else if (value === 'false') args.push(false);
      else if ((value[0] === "'" && value[value.length - 1] === "'") || (value[0] === '"' && value[value.length - 1] === '"')) {
        args.push(value.slice(1, -1).replace(/\\(['"\\])/g, '$1'));
      } else args.push(value);
    }
    for (var i = 0; i < source.length; i++) {
      var ch = source[i];
      if (quote) {
        current += ch;
        if (ch === quote && source[i - 1] !== '\\') quote = '';
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { push(current); current = ''; }
      else current += ch;
    }
    if (current.trim()) push(current);
    return args;
  }

  function callNamed(name, args) {
    var fn = window[name];
    if (typeof fn !== 'function') {
      console.error('[IVX CSP Actions] Missing action:', name);
      return false;
    }
    fn.apply(window, args);
    return true;
  }

  function run(source, event, element) {
    if (!source) return;
    if (/event\.target\s*===\s*this/.test(source) && event.target !== element) return;
    if (source.indexOf('IVXOpenReels') !== -1) {
      event.preventDefault();
      if (typeof window.IVXOpenReels === 'function') window.IVXOpenReels();
      return;
    }
    if (source.indexOf("window.location.href='#properties'") !== -1) {
      event.preventDefault();
      window.location.hash = 'properties';
    }
    splitStatements(source).forEach(function (statement) {
      if (statement === 'return false') { event.preventDefault(); return; }
      if (statement.indexOf('document.') !== -1 || statement.indexOf('this.') !== -1 || statement.indexOf('window.location') !== -1) return;
      statement = statement.replace(/^return\s+/, '').replace(/^if\s*\([^)]*\)\s*/, '').trim();
      var match = statement.match(/^(?:window\.)?([A-Za-z_$][\w$]*)\s*\((.*)\)$/);
      if (!match) return;
      event.preventDefault();
      callNamed(match[1], parseArgs(match[2], event, element));
    });
  }

  function bind(root) {
    var nodes = [];
    if (root.nodeType === 1 && root.matches('[onclick],[onsubmit],[onchange]')) nodes.push(root);
    if (root.querySelectorAll) nodes = nodes.concat([].slice.call(root.querySelectorAll('[onclick],[onsubmit],[onchange]')));
    nodes.forEach(function (element) {
      ['click', 'submit', 'change'].forEach(function (type) {
        var attr = type === 'click' ? 'onclick' : type === 'submit' ? 'onsubmit' : 'onchange';
        var source = element.getAttribute(attr);
        if (!source) return;
        element.removeAttribute(attr);
        element.addEventListener(type, function (event) { run(source, event, element); });
      });
    });
  }

  bind(document);
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(function (node) { if (node.nodeType === 1) bind(node); });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
