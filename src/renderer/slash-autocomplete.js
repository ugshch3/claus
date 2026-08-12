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
  }

  return { attach };
})();

window.SlashAutocomplete = SlashAutocomplete;
