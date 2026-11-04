import nodemailer from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { magicLinkEmailContent } from "./email/magic-link";

export async function sendMagicLinkEmail({ email, url }: { email: string; url: string }) {
  const { AWS_SES_REGION, AUTH_EMAIL_FROM } = process.env;
  // Keep mail credentials separate from the instance role used by other AWS services.
  const scoped = Boolean(process.env.AWS_SES_ACCESS_KEY_ID || process.env.AWS_SES_SECRET_ACCESS_KEY || process.env.AWS_SES_SESSION_TOKEN);
  const accessKeyId = scoped ? process.env.AWS_SES_ACCESS_KEY_ID : process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = scoped ? process.env.AWS_SES_SECRET_ACCESS_KEY : process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = scoped ? process.env.AWS_SES_SESSION_TOKEN : process.env.AWS_SESSION_TOKEN;
  if (AWS_SES_REGION || AUTH_EMAIL_FROM) {
    if (!AWS_SES_REGION || !accessKeyId || !secretAccessKey || !AUTH_EMAIL_FROM) {
      throw new Error("Amazon SES email delivery is not fully configured.");
    }
    const content = magicLinkEmailContent(url);
    const sesClient = new SESv2Client({
      region: AWS_SES_REGION,
      credentials: { accessKeyId, secretAccessKey, sessionToken },
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 20_000 },
    });
    try {
      // Simple content uses ses:SendEmail; raw MIME requires ses:SendRawEmail.
      await sesClient.send(new SendEmailCommand({
        FromEmailAddress: AUTH_EMAIL_FROM,
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: {
            Subject: { Data: content.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: content.text, Charset: "UTF-8" },
              Html: { Data: content.html, Charset: "UTF-8" },
            },
            Attachments: content.attachments.map(attachment => ({
              FileName: attachment.filename,
              RawContent: attachment.content,
              ContentType: attachment.contentType,
              ContentDisposition: "INLINE",
              ContentId: attachment.cid,
              ContentTransferEncoding: "BASE64",
            })),
          },
        },
      }));
    } finally {
      sesClient.destroy();
    }
    return;
  }
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !MAIL_FROM) {
    throw new Error("Magic link email delivery is not configured.");
  }
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: process.env.SMTP_SECURE !== "true",
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  await transport.sendMail({
    from: MAIL_FROM,
    to: email,
    ...magicLinkEmailContent(url),
  });
}
