/**
 * Селекторы страницы авторизации Creatio (NUI).
 * Переопределение через env при необходимости.
 */
export const CreatioSelectors = {
  loginInput: process.env.CREATIO_LOGIN_INPUT_SEL || '#loginEdit-el',
  passwordInput: process.env.CREATIO_PASSWORD_INPUT_SEL || '#passwordEdit-el',
  /** Текст на кнопке (fallback для getByText / role) */
  loginButtonName: process.env.CREATIO_LOGIN_BUTTON_TEXT || 'Войти',
};
