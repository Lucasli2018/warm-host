// 邮件发送（Resend API，可插拔）
// 从 shop-booking 复制
//
// 环境变量（Pages 项目 Settings → Variables）：
//   RESEND_API_KEY - Resend 的 API Key（re_ 开头）。未配置时本模块静默跳过，不影响流程。
//   MAIL_FROM      - 发件人，如 'warm-host <noreply@yourdomain.com>'。
//                    未配置时用 Resend 默认测试发件人 'onboarding@resend.dev'（仅能发给注册邮箱）。
//
// 为什么用 waitUntil：邮件发送失败不应阻塞/影响业务流程，也不该让用户看到报错。

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailValid(email) {
  return typeof email === "string" && EMAIL_RE.test(email);
}

export async function sendEmail(env, { to, subject, html }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "RESEND_API_KEY 未配置，跳过发送" };
  }
  if (!isEmailValid(to)) {
    return { sent: false, reason: "收件邮箱无效" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || "onboarding@resend.dev",
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[email] Resend 返回错误:", res.status, text.slice(0, 200));
      return { sent: false, reason: `Resend ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] 发送异常:", err);
    return { sent: false, reason: String(err && err.message || err) };
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
