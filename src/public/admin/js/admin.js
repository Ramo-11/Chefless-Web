// ── Sidebar Toggle ──────────────────────────────────────────
document.getElementById('mobile-toggle')?.addEventListener('click', function () {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
});

document.getElementById('sidebar-overlay')?.addEventListener('click', function () {
  document.getElementById('sidebar').classList.remove('open');
  this.classList.remove('open');
});

// ── Modal Helpers ───────────────────────────────────────────
function openModal(id) {
  var modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    // Focus trap: focus the first focusable element
    var focusable = modal.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();
  }
}

function closeModal(id) {
  var modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

// Close modal on backdrop click
document.querySelectorAll('.modal').forEach(function (modal) {
  modal.addEventListener('click', function (e) {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
});

// Close modal on Escape
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.active').forEach(function (modal) {
      modal.classList.remove('active');
    });
  }
});

// ── Row Action Menus ────────────────────────────────────────
// Every table row exposes its actions through a "..." trigger that opens a
// list of worded actions. The list is placed with position: fixed because
// .table-responsive scrolls horizontally and would otherwise clip it.
(function () {
  var openList = null;

  function closeRowMenu() {
    if (!openList) return;
    openList.classList.remove('open');
    var trigger = openList.parentElement.querySelector('.row-menu-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    openList = null;
  }

  function placeRowMenu(trigger, list) {
    var margin = 8;
    var rect = trigger.getBoundingClientRect();

    // Measure off-screen before deciding which way the menu should open.
    list.style.top = '-9999px';
    list.style.left = '-9999px';
    list.classList.add('open');

    var width = list.offsetWidth;
    var height = list.offsetHeight;

    var left = rect.right - width;
    if (left < margin) left = margin;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - width);
    }

    var top = rect.bottom + 4;
    if (top + height > window.innerHeight - margin) {
      var above = rect.top - height - 4;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - height);
    }

    list.style.left = Math.round(left) + 'px';
    list.style.top = Math.round(top) + 'px';
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest ? e.target.closest('.row-menu-trigger') : null;

    if (trigger) {
      e.preventDefault();
      e.stopPropagation();
      var list = trigger.parentElement.querySelector('.row-menu-list');
      if (!list) return;
      var wasOpen = list === openList;
      closeRowMenu();
      if (wasOpen) return;
      placeRowMenu(trigger, list);
      trigger.setAttribute('aria-expanded', 'true');
      openList = list;
      var first = list.querySelector('.row-menu-item:not(:disabled)');
      if (first) first.focus();
      return;
    }

    // Any click elsewhere (including on a menu item, which runs its own
    // handler first) dismisses the open menu.
    closeRowMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openList) {
      var trigger = openList.parentElement.querySelector('.row-menu-trigger');
      closeRowMenu();
      if (trigger) trigger.focus();
    }
  });

  window.addEventListener('resize', closeRowMenu);
  window.addEventListener('scroll', closeRowMenu, true);
})();

// ── Toast ───────────────────────────────────────────────────
function showToast(message, type) {
  var toast = document.getElementById('toast');
  if (!toast) return;

  // Success vs error reads from the coloured left border on .toast-success /
  // .toast-error; there is no status glyph.
  toast.className = 'toast toast-' + (type || 'success') + ' show';
  toast.querySelector('.toast-message').textContent = message;

  setTimeout(function () {
    toast.classList.remove('show');
  }, 3000);
}

/**
 * Show toast then reload after a short delay so the user sees the message.
 */
function toastAndReload(message, type) {
  showToast(message, type || 'success');
  setTimeout(function () { location.reload(); }, 1200);
}

// ── XSS-safe HTML helpers ───────────────────────────────────
/**
 * Escapes HTML entities in a string to prevent XSS when inserting into innerHTML.
 */
function esc(str) {
  if (str == null) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

// ── CSRF Token ─────────────────────────────────────────────
function getCsrfToken() {
  var meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') : '';
}

// ── Admin Fetch Helper ──────────────────────────────────────
/**
 * Wrapper around fetch with standard JSON handling, CSRF token, and error display.
 */
function adminFetch(url, options) {
  var opts = Object.assign({
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': getCsrfToken()
    }
  }, options || {});

  // Ensure CSRF header is always present even if caller overrides headers
  if (opts.headers && !opts.headers['x-csrf-token']) {
    opts.headers['x-csrf-token'] = getCsrfToken();
  }

  return fetch(url, opts)
    .then(function (r) {
      // An expired admin session 302-redirects to /admin/login. fetch follows
      // the redirect, so we land on the login page (HTML, status 200). Detect
      // that and surface a clear message instead of "Unexpected token '<'".
      if (r.redirected && r.url.indexOf('/admin/login') !== -1) {
        throw new Error('Your admin session expired. Reload the page and log in again.');
      }
      var contentType = r.headers.get('content-type') || '';
      if (contentType.indexOf('application/json') === -1) {
        // Any non-JSON response (HTML error page, plain-text 404, etc.).
        throw new Error(
          r.status === 401 || r.status === 403
            ? 'Session or permission error. Reload the page and log in again.'
            : 'Unexpected server response (status ' + r.status + '). Try reloading the page.'
        );
      }
      if (!r.ok) {
        return r.json().then(function (d) {
          throw new Error(d.error || 'Request failed');
        });
      }
      return r.json();
    });
}
