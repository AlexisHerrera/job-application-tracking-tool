"""Mailer on Gmail's SMTP: from GMAIL_ADDRESS to itself, with the app password the ingest already
reads mail with. The ingest skips mail from your own address (core/pipeline), so the digest never
reaches the LLM."""

from __future__ import annotations

import smtplib
from email.message import EmailMessage

DIGEST_HEADER = "X-Jobtracker"


class GmailSmtpMailer:
    def __init__(self, host: str, address: str, app_password: str, timeout: float = 30):
        if not (address and app_password):
            raise ValueError("the digest needs GMAIL_ADDRESS and GMAIL_APP_PASSWORD")
        self.host, self.address, self.timeout = host, address, timeout
        self._password = app_password

    def __repr__(self) -> str:
        return f"GmailSmtpMailer({self.host!r}, {self.address!r})"

    def send(self, subject: str, text: str, html: str) -> None:
        msg = EmailMessage()
        msg["From"] = msg["To"] = self.address
        msg["Subject"] = subject
        msg[DIGEST_HEADER] = "digest"
        msg.set_content(text)
        msg.add_alternative(html, subtype="html")
        with smtplib.SMTP_SSL(self.host, 465, timeout=self.timeout) as smtp:
            smtp.login(self.address, self._password)
            smtp.send_message(msg)
