// Business email validation: format + blocklist of common public providers.

const BLOCKED_DOMAINS = new Set([
  // Mainstream consumer mail
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.be", "hotmail.nl", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.it",
  "outlook.com", "outlook.be", "outlook.nl", "outlook.fr", "outlook.de",
  "live.com", "live.nl", "live.be",
  "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.it", "yahoo.es", "yahoo.nl",
  "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "aim.com",
  // Privacy-focused / European consumer
  "protonmail.com", "proton.me", "pm.me",
  "tutanota.com", "tutanota.de", "tuta.io",
  "gmx.com", "gmx.net", "gmx.de", "gmx.at", "gmx.ch",
  "mail.com",
  "zoho.com",
  "yandex.com", "yandex.ru", "ya.ru",
  "fastmail.com", "fastmail.fm",
  "hey.com",
  "inbox.com",
  "mailbox.org",
  "disroot.org",
  // Belgian/Dutch ISPs that are personal mail
  "telenet.be", "skynet.be", "scarlet.be", "proximus.be",
  "ziggo.nl", "kpnmail.nl", "kpn.com", "planet.nl", "xs4all.nl", "home.nl", "online.nl",
  // Disposable
  "mailinator.com", "10minutemail.com", "trashmail.com", "guerrillamail.com", "yopmail.com",
  "throwawaymail.com", "tempmail.com", "temp-mail.org", "getnada.com", "dispostable.com",
]);

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function validateBusinessEmail(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email) return { ok: false, reason: "Geef een e-mailadres in." };
  if (email.length > 254) return { ok: false, reason: "Dit e-mailadres is te lang." };
  if (!EMAIL_REGEX.test(email)) return { ok: false, reason: "Dit ziet er niet uit als een geldig e-mailadres." };

  const domain = email.split("@")[1];
  if (BLOCKED_DOMAINS.has(domain)) {
    return {
      ok: false,
      reason: "Gebruik een organisatie- of bedrijfse-mail. Publieke domeinen (Gmail, Hotmail, Outlook, …) worden niet aanvaard.",
    };
  }

  // Catch typo-prone variants like 'gmail.con'
  const typoHints = ["gmail.con", "gmail.cm", "hotmail.con", "outlook.con", "yahoo.con"];
  if (typoHints.includes(domain)) {
    return { ok: false, reason: "Het domein lijkt op een typo. Bedoelde u een ander e-mailadres?" };
  }

  return { ok: true, email };
}
