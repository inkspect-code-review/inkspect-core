import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { magicLinkEmailContent } from "../../src/lib/email/magic-link";
import { sendMagicLinkEmail } from "../../src/lib/mail";

test("the HTML and plain-text alternatives keep the same single-use URL with safe HTML escaping", () => {
  const url = 'https://app.inkspect.si/api/auth/magic-link/verify?token=synthetic&callbackURL=/dashboard&test="<tag>\'';
  const message = magicLinkEmailContent(url);
  assert.ok(message.text.includes(url));
  assert.ok(message.html.includes("&amp;callbackURL="));
  assert.ok(message.html.includes("&quot;&lt;tag&gt;&#39;"));
  assert.ok(!message.html.includes('<tag>'));
  assert.equal(message.html.match(/href="https:\/\/app\.inkspect\.si/g)?.length, 2);
  assert.doesNotMatch(message.html, /\{\{|email-preview|data:image/);
  assert.match(message.html, /10 minutes/);
  assert.match(message.html, /cid:inkspect-sign-in-mark/);
  assert.equal(message.attachments[0].content.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("SES API uses the configured sender and preserves HTML, text and inline image", async (t) => {
  const values = { AWS_SES_REGION: "eu-west-2", AWS_ACCESS_KEY_ID: "synthetic-key", AWS_SECRET_ACCESS_KEY: "synthetic-secret", AUTH_EMAIL_FROM: "Inkspect <sign-in@example.test>" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  let calls = 0;
  t.mock.method(SESv2Client.prototype, "send", async (command: SendEmailCommand) => {
    calls++;
    assert.ok(command instanceof SendEmailCommand);
    assert.equal(command.input.FromEmailAddress, values.AUTH_EMAIL_FROM);
    assert.deepEqual(command.input.Destination?.ToAddresses, ["reader@example.test"]);
    assert.equal(command.input.Content?.Raw, undefined);
    const simple = command.input.Content?.Simple;
    assert.equal(simple?.Subject?.Data, "Sign in to Inkspect");
    assert.match(simple?.Body?.Html?.Data ?? "", /cid:inkspect-sign-in-mark/);
    assert.match(simple?.Body?.Text?.Data ?? "", /https:\/\/app.inkspect.si\/login\?token=synthetic/);
    const attachment = simple?.Attachments?.[0];
    assert.equal(attachment?.ContentDisposition, "INLINE");
    assert.equal(attachment?.ContentId, "inkspect-sign-in-mark");
    assert.equal(attachment?.ContentTransferEncoding, "BASE64");
    assert.equal(Buffer.from(attachment?.RawContent ?? []).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    return { MessageId: "synthetic-message-id" };
  });
  const destroy = t.mock.method(SESv2Client.prototype, "destroy");
  try {
    await sendMagicLinkEmail({ email: "reader@example.test", url: "https://app.inkspect.si/login?token=synthetic" });
    assert.equal(calls, 1);
    assert.equal(destroy.mock.callCount(), 1);
    delete process.env.AWS_SECRET_ACCESS_KEY;
    await assert.rejects(sendMagicLinkEmail({ email: "reader@example.test", url: "https://app.inkspect.si/login" }), /not fully configured/);
    assert.equal(calls, 1);
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("SES-specific credentials take precedence and incomplete pairs never borrow generic credentials", async (t) => {
  const values = { AWS_SES_REGION: "eu-west-2", AWS_SES_ACCESS_KEY_ID: "mail-key", AWS_SES_SECRET_ACCESS_KEY: "mail-secret", AWS_ACCESS_KEY_ID: "other-key", AWS_SECRET_ACCESS_KEY: "other-secret", AUTH_EMAIL_FROM: "sign-in@example.test" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const send = t.mock.method(SESv2Client.prototype, "send", async function (this: SESv2Client) {
    const credentials = await this.config.credentials();
    assert.equal(credentials.accessKeyId, "mail-key");
    assert.equal(credentials.secretAccessKey, "mail-secret");
    return { MessageId: "synthetic-message-id" };
  });
  try {
    await sendMagicLinkEmail({ email: "reader@example.test", url: "https://app.inkspect.si/login" });
    delete process.env.AWS_SES_SECRET_ACCESS_KEY;
    await assert.rejects(sendMagicLinkEmail({ email: "reader@example.test", url: "https://app.inkspect.si/login" }), /not fully configured/);
    assert.equal(send.mock.callCount(), 1);
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("sign-in mail rejects unsafe URL schemes and permits local development URLs", () => {
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "http://app.inkspect.si/login", "https://user:password@app.inkspect.si/login", "https://app.inkspect.si/\r\nInjected"]) {
    assert.throws(() => magicLinkEmailContent(url));
  }
  assert.match(magicLinkEmailContent("http://localhost:3002/api/auth/magic-link/verify?token=test").text, /localhost:3002/);
});

test("SMTP sending includes both alternatives and an inline PNG without filesystem or network image access", async (t) => {
  const keys = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM", "SMTP_PORT", "SMTP_SECURE"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { SMTP_HOST: "email-smtp.example.test", SMTP_USER: "synthetic-user", SMTP_PASSWORD: "synthetic-password", MAIL_FROM: "Inkspect <sign-in@example.test>", SMTP_PORT: "587", SMTP_SECURE: "false" });
  // Generate the actual MIME message in memory; no SMTP connection or mail delivery.
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const send = t.mock.method(transport, "sendMail");
  const create = t.mock.method(nodemailer, "createTransport", () => transport);
  try {
    await sendMagicLinkEmail({ email: "reader@example.test", url: "https://app.inkspect.si/api/auth/magic-link/verify?token=synthetic&callbackURL=/dashboard" });
    const options = create.mock.calls[0].arguments[0];
    assert.ok(options && typeof options === "object");
    assert.ok("requireTLS" in options && options.requireTLS === true);
    assert.ok("disableFileAccess" in options && options.disableFileAccess === true);
    assert.ok("disableUrlAccess" in options && options.disableUrlAccess === true);
    const info: unknown = await send.mock.calls[0].result;
    assert.ok(info && typeof info === "object" && "message" in info);
    assert.ok(Buffer.isBuffer(info.message));
    const mime = info.message.toString();
    assert.match(mime, /Content-Type: multipart\/alternative/);
    assert.match(mime, /Content-Type: multipart\/related/);
    assert.match(mime, /Content-Type: text\/plain/);
    assert.match(mime, /Content-Type: text\/html/);
    assert.match(mime, /Content-Type: image\/png/);
    assert.match(mime, /Content-ID: <inkspect-sign-in-mark>/);
    assert.match(mime, /Subject: Sign in to Inkspect/);
    assert.match(mime, /To: reader@example.test/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    transport.close();
  }
});
