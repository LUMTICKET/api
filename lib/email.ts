import nodemailer from "nodemailer";

let transport: nodemailer.Transporter | null = null;

function getTransport() {
  if (transport) return transport;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  if (!host || !user || !password) {
    throw new Error("SMTP_HOST, SMTP_USER and SMTP_PASSWORD must be configured");
  }

  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass: password },
  });

  return transport;
}

interface InvitationEmailParams {
  to: string;
  name: string;
  inviterName: string;
  businessName: string;
  acceptLink: string;
  role: string;
}

export async function sendInvitationEmail({
  to,
  name,
  inviterName,
  businessName,
  acceptLink,
  role,
}: InvitationEmailParams) {
  try {
    const result = await getTransport().sendMail({
      from: process.env.FROM_EMAIL || "Team <team@yourdomain.com>",
      to,
      subject: `${inviterName} invited you to join ${businessName} on Lum`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Team Invitation</title>
          </head>
          <body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
              <tr>
                <td align="center">
                  <table width="480" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:16px;overflow:hidden;border:1px solid #262626;">
                    <tr>
                      <td style="padding:40px 32px 24px;">
                        <div style="width:48px;height:48px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:12px;margin-bottom:24px;"></div>
                        <h1 style="color:#fafafa;font-size:22px;font-weight:700;margin:0 0 8px;line-height:1.3;">
                          You've been invited
                        </h1>
                        <p style="color:#a3a3a3;font-size:15px;margin:0 0 24px;line-height:1.6;">
                          Hi <strong style="color:#fafafa;">${name}</strong>,<br />
                          <strong style="color:#fafafa;">${inviterName}</strong> invited you to join 
                          <strong style="color:#fafafa;">${businessName}</strong> as a 
                          <strong style="color:#f59e0b;">${role}</strong>.
                        </p>
                        
                        <a href="${acceptLink}" 
                           style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000000;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:600;margin-bottom:24px;">
                          Accept Invitation
                        </a>
                        
                        <p style="color:#525252;font-size:13px;margin:0 0 8px;line-height:1.5;">
                          Or copy and paste this link:
                        </p>
                        <p style="color:#737373;font-size:12px;margin:0;word-break:break-all;background:#0a0a0a;padding:10px 12px;border-radius:8px;border:1px solid #262626;">
                          ${acceptLink}
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:20px 32px 32px;border-top:1px solid #262626;">
                        <p style="color:#525252;font-size:12px;margin:0;line-height:1.5;">
                          This invitation expires in 7 days. If you didn't expect this invitation, you can safely ignore this email.
                        </p>
                      </td>
                    </tr>
                  </table>
                  <p style="color:#404040;font-size:12px;margin-top:20px;">
                    Sent by Lum
                  </p>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    });

    return result;
  } catch (err) {
    console.error("Failed to send invitation email:", err);
    throw err;
  }
}