// The public pages need mobile menu toggling, not a general HTML plugin runtime.
for (const button of document.querySelectorAll('button.navbar-toggler[aria-controls]')) {
  const target = document.getElementById(button.getAttribute('aria-controls'));
  if (!target || !target.classList.contains('navbar-collapse')) continue;
  button.addEventListener('click', () => {
    const expanded = target.classList.toggle('show');
    button.setAttribute('aria-expanded', String(expanded));
  });
}
