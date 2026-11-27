import { signIn } from './shared-client.mjs';

const form = document.getElementById('login');
const username = document.getElementById('username');
const button = form.querySelector('button');
const notice = document.getElementById('login-notice');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  notice.textContent = '';
  try {
    await signIn(username.value);
    const returnTo = new URLSearchParams(location.search).get('returnTo');
    location.replace(returnTo === 'gm' ? '/gm/' : '/arena/');
  } catch (error) {
    notice.textContent = error.message;
    button.disabled = false;
  }
});
