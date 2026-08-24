// Slash Autocomplete — autocomplete for Claude Code /-commands and skills
// ==========================================

// Самодостаточный модуль. Подключается к textarea через `attach()`.
// Список команд приходит из main-процесса в виде:
//   { skills: [{ name, description, source }], builtIn: [...] }
const SlashAutocomplete = (function () {
  let active = null; // { textarea, items, commandStart, activeIndex }

  const dropdown = document.createElement('div');
  dropdown.className = 'slash-dropdown hidden';
  document.body.appendChild(dropdown);

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Подключает автодополнение к полю ввода.
   * @param {HTMLTextAreaElement} textarea
   * @param {HTMLButtonElement} button — кнопка-подсказка "/"
   * @param {{skills: Array, builtIn: Array}} skillsCache
   */
  function attach(textarea, button, skillsCache) {
    button.addEventListener('click', () => {
      textarea.focus();
      open(textarea, skillsCache, '', textarea.selectionStart);
    });

    textarea.addEventListener('input', () => {
      const ctx = getCommandContext(textarea);
      if (ctx) {
        open(textarea, skillsCache, ctx.query, ctx.start);
      } else {
        close();
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (!active || active.textarea !== textarea) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectItem(active.activeIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    textarea.addEventListener('blur', () => close());
  }

  /**
   * Определяет, вводится ли сейчас /-команда. Возвращает позицию "/"
   * и строку запроса после неё, либо null.
   */
  function getCommandContext(textarea) {
    const cursor = textarea.selectionStart;
    const before = textarea.value.slice(0, cursor);
    const match = before.match(/(\S+)$/);
    if (!match) return null;
    const word = match[1];
    if (!word.startsWith('/')) return null;
    return { start: match.index, query: word.slice(1) };
  }

  function filterItems(skillsCache, query) {
    const skills = skillsCache.skills.filter(s => s.name.startsWith(query));
    const builtIn = skillsCache.builtIn.filter(s => s.name.startsWith(query));
    return [...skills, ...builtIn];
  }

  function open(textarea, skillsCache, query, commandStart) {
    const items = filterItems(skillsCache, query);
    active = { textarea, items, commandStart, activeIndex: 0 };
    render();
    position();
  }

  function render() {
    dropdown.innerHTML = '';
    if (active.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'slash-dropdown-empty';
      empty.textContent = 'No matching commands';
      dropdown.appendChild(empty);
    } else {
      active.items.forEach((item, index) => {
        const el = document.createElement('div');
        el.className = 'slash-dropdown-item' + (index === active.activeIndex ? ' active' : '');
        const name = document.createElement('span');
        name.className = 'cmd-name';
        name.textContent = '/' + item.name;
        const desc = document.createElement('span');
        desc.className = 'cmd-desc';
        desc.textContent = item.description;
        const source = document.createElement('span');
        source.className = 'cmd-source';
        source.textContent = item.source;
        el.append(name, desc, source);
        // mousedown + preventDefault, чтобы textarea не теряла фокус до выбора
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectItem(index);
        });
        dropdown.appendChild(el);
      });
    }
    dropdown.classList.remove('hidden');
  }

  function position() {
    const rect = active.textarea.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    dropdown.style.left = (rect.left + window.scrollX) + 'px';
    dropdown.style.width = Math.max(rect.width, 320) + 'px';
  }

  function move(delta) {
    if (!active || active.items.length === 0) return;
    active.activeIndex = (active.activeIndex + delta + active.items.length) % active.items.length;
    const children = dropdown.querySelectorAll('.slash-dropdown-item');
    children.forEach((el, i) => {
      el.classList.toggle('active', i === active.activeIndex);
    });
  }

  function selectItem(index) {
    if (!active || !active.items[index]) return;
    const textarea = active.textarea;
    const item = active.items[index];
    const cursor = textarea.selectionStart;
    const start = active.commandStart;
    const needsSpace = start > 0 && !/\s$/.test(textarea.value.slice(0, start));
    const prefix = needsSpace ? ' ' : '';
    const replacement = prefix + '/' + item.name + ' ';
    textarea.value =
      textarea.value.slice(0, start) + replacement + textarea.value.slice(cursor);
    const newCursor = start + replacement.length;
    textarea.selectionStart = textarea.selectionEnd = newCursor;
    close();
    textarea.focus();
  }

  function close() {
    active = null;
    dropdown.classList.add('hidden');
  }

  return { attach };
})();

window.SlashAutocomplete = SlashAutocomplete;
