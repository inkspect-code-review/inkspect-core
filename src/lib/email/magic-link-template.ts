// Approved Inkspect sign-in email. Keep layout and styles email-client compatible.
export const magicLinkTemplate = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>Sign in to Inkspect</title>
    <style>
      body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      table { border-collapse: collapse; }
      img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
      a:focus-visible { outline: 2px solid #626262; outline-offset: 4px; }
      @media only screen and (max-width: 600px) {
        .outer { padding: 20px 12px !important; }
        .brand { padding: 28px !important; }
        .content { padding: 34px 28px 32px !important; }
        .title { font-size: 30px !important; line-height: 37px !important; }
        .mark { width: 48px !important; height: 60px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;width:100%;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#000000;">
    <div style="display:none;font-size:1px;color:#f4f4f4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Your one-time sign-in link. Valid for 10 minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f4" style="width:100%;background-color:#f4f4f4;">
      <tr>
        <td class="outer" align="center" style="padding:56px 24px;">
          <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;background-color:#ffffff;">
            <tr>
              <td class="brand" bgcolor="#000000" style="padding:34px 44px;background-color:#000000;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                  <tr>
                    <td align="left" valign="middle" style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:36px;font-weight:700;letter-spacing:-1.3px;">Inkspect</td>
                    <td align="right" valign="middle" width="64"><img class="mark" src="{{logoUrl}}" width="64" height="80" alt="" style="display:block;width:64px;height:80px;color:#ffffff;" /></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="content" style="padding:42px 44px 38px;">
                <h1 class="title" style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:41px;font-weight:700;letter-spacing:-1.2px;color:#000000;">Your sign-in link.</h1>
                <p style="margin:0 0 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:25px;color:#626262;">Continue to your Inkspect account.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                  <tr>
                    <td align="center" bgcolor="#000000" height="52" style="background-color:#000000;border-radius:6px;height:52px;mso-padding-alt:0 24px;">
                      <a href="{{signInUrl}}" style="display:block;padding:0 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:52px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;text-align:center;">Sign in to Inkspect</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 30px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#626262;">This link expires in <strong style="font-weight:700;color:#000000;">10 minutes</strong> and can only be used once.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                  <tr><td height="1" bgcolor="#e7e7e7" style="height:1px;font-size:1px;line-height:1px;background-color:#e7e7e7;">&nbsp;</td></tr>
                </table>
                <p style="margin:26px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#626262;">If the button doesn’t work, copy this link into your browser:</p>
                <p style="margin:0 0 26px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere;"><a href="{{signInUrl}}" style="color:#000000;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">{{signInUrl}}</a></p>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#626262;">If you didn’t request this email, you can safely ignore it.</p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
          <p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;color:#626262;"><a href="https://inkspect.si" style="color:#626262;text-decoration:none;">inkspect.si</a></p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
