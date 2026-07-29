// Stub for delivering a share invite. Sending real email needs a backend
// (SES / Postmark / Resend etc.) — a browser cannot send mail on its own.
// Until then, shareCanvas() records the recipient locally and this returns
// delivered:false so the UI can say so honestly rather than implying an
// email went out.
export async function sendShareInvite({ canvasTitle, recipientEmail, fromEmail }) {
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    delivered: false,
    reason: 'No mail backend configured — access was granted locally only.',
    preview: {
      to: recipientEmail,
      from: fromEmail,
      subject: `${fromEmail} shared "${canvasTitle}" with you on HistoryChart`,
    },
  };
}
