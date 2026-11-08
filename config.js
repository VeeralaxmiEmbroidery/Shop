/*
 * Shop configuration. This is the only file you must edit on the website side.
 *
 * Values from the "Settings" tab of the Google Sheet (SHOP_NAME, UPI_ID,
 * UPI_PAYEE_NAME, WHATSAPP_NUMBER, ORDER_PREFIX) override the ones below once
 * API_URL is set, so the shop owner can change them without touching code.
 */
window.SHOP_CONFIG = {
  // Apps Script web app URL ending in /exec. Leave empty to run in demo mode.
  API_URL: "https://script.google.com/macros/s/AKfycbz6XYW7IBW3L2FOvfDn4g3jl2SscIrB7bARyHKPmVm1TkGH0UnQwapCVWG5f0wDHzQ4/exec",

  // true = use built-in sample designs and store orders in this browser only.
  // Set to false after you paste API_URL.
  DEMO_MODE: false,

  SHOP_NAME: "Veeralaxmi Embroidery",
  TAGLINE: "Machine embroidery designs in DST format. Pay by UPI, download instantly after confirmation.",

  // UPI ID that receives payments, and the name shown in the customer's UPI app.
  UPI_ID: "7032453566-2@axl",
  UPI_PAYEE_NAME: "Nadigatla Pavanpardh",

  // Shop WhatsApp number: country code + number, digits only (no +, spaces or dashes).
  WHATSAPP_NUMBER: "917032453566",

  ORDER_PREFIX: "VL",
  CURRENCY_SYMBOL: "\u20B9",

  // How long the shop usually takes to verify a payment (shown to customers).
  VERIFY_TIME_TEXT: "within a few hours (9am to 9pm)",

  // Number of designs shown before the "Show more" button.
  PAGE_SIZE: 24
};
