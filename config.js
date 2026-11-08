/*
 * Shop configuration. This is the only file you must edit on the website side.
 *
 * Values from the "Settings" tab of the Google Sheet (SHOP_NAME, UPI_ID,
 * UPI_PAYEE_NAME, WHATSAPP_NUMBER, ORDER_PREFIX) override the ones below once
 * API_URL is set, so the shop owner can change them without touching code.
 */
window.SHOP_CONFIG = {
  // Apps Script web app URL ending in /exec. Leave empty to run in demo mode.
  API_URL: "",

  // true = use built-in sample designs and store orders in this browser only.
  // Set to false after you paste API_URL.
  DEMO_MODE: true,

  SHOP_NAME: "Embroidery Designs",
  TAGLINE: "Machine embroidery designs in DST format. Pay by UPI, download instantly after confirmation.",

  // UPI ID that receives payments, and the name shown in the customer's UPI app.
  UPI_ID: "yourshop@okaxis",
  UPI_PAYEE_NAME: "Sui Dhaaga Designs",

  // Shop WhatsApp number: country code + number, digits only (no +, spaces or dashes).
  WHATSAPP_NUMBER: "919666962333",

  ORDER_PREFIX: "EMB",
  CURRENCY_SYMBOL: "\u20B9",

  // How long the shop usually takes to verify a payment (shown to customers).
  VERIFY_TIME_TEXT: "within a few hours (9am to 9pm)",

  // Number of designs shown before the "Show more" button.
  PAGE_SIZE: 24
};
