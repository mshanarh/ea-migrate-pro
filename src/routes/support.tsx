import type { FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Mail, MapPin, MessageCircle } from "lucide-react";

export const Route = createFileRoute("/support")({
  head: () => ({ meta: [{ title: "Support - EA Migrate Pro" }, { name: "description", content: "Contact EA Migrate Pro support." }] }),
  component: Support,
});

const SUPPORT_EMAIL = "eamigratepro@gmail.com";
const WHATSAPP_URL = "https://wa.me/27704950612";

function Support() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const firstName = String(data.get("firstName") || "").trim();
    const lastName = String(data.get("lastName") || "").trim();
    const email = String(data.get("email") || "").trim();
    const message = String(data.get("message") || "").trim();
    const subject = encodeURIComponent(`Support request from ${firstName} ${lastName}`);
    const body = encodeURIComponent(`Name: ${firstName} ${lastName}\nEmail: ${email}\n\nMessage:\n${message}`);
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  };

  return <main className="min-h-screen bg-[#0A0A0A] px-5 py-12 text-white"><div className="mx-auto max-w-[480px]"><Link to="/" className="inline-flex items-center gap-2 text-sm text-white/50 transition hover:text-[#38BDF8]"><ArrowLeft className="size-4" />Back to EA Migrate Pro</Link><header className="mt-8"><h1 className="text-4xl font-black">Get in <span className="text-[#38BDF8]">Touch</span></h1><p className="mt-3 text-white/50">Have questions? Our team is here to help.</p></header><section className="mt-8 rounded-3xl border border-white/10 bg-[#121212] p-6"><h2 className="text-xl font-semibold">Send us a message</h2><form onSubmit={handleSubmit} className="mt-6 space-y-4"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="text-sm font-medium">First Name<input name="firstName" placeholder="John" required className="mt-2 h-12 w-full rounded-xl bg-[#1A2332] px-4 outline-none placeholder:text-white/35 focus:ring-2 focus:ring-[#38BDF8]" /></label><label className="text-sm font-medium">Last Name<input name="lastName" placeholder="Doe" required className="mt-2 h-12 w-full rounded-xl bg-[#1A2332] px-4 outline-none placeholder:text-white/35 focus:ring-2 focus:ring-[#38BDF8]" /></label></div><label className="block text-sm font-medium">Email<input name="email" type="email" placeholder="you@example.com" required className="mt-2 h-12 w-full rounded-xl bg-[#1A2332] px-4 outline-none placeholder:text-white/35 focus:ring-2 focus:ring-[#38BDF8]" /></label><label className="block text-sm font-medium">Message<textarea name="message" placeholder="How can we help?" required rows={4} className="mt-2 w-full resize-none rounded-xl bg-[#1A2332] px-4 py-3 outline-none placeholder:text-white/35 focus:ring-2 focus:ring-[#38BDF8]" /></label><button type="submit" className="h-12 w-full rounded-xl bg-[#00A8FF] font-semibold text-[#0A0A0A] transition hover:bg-[#38BDF8]">Send Message</button></form></section><div className="mt-6 space-y-4"><div className="flex items-start gap-4 rounded-3xl border border-white/10 bg-[#121212] p-5"><Mail className="mt-1 size-6 shrink-0 text-[#38BDF8]" /><div><h2 className="font-semibold">Email</h2><a href={`mailto:${SUPPORT_EMAIL}`} className="transition hover:text-[#38BDF8]">{SUPPORT_EMAIL}</a><p className="mt-1 text-sm text-white/40">We&apos;ll respond within 24 hours</p></div></div><div className="flex items-start gap-4 rounded-3xl border border-white/10 bg-[#121212] p-5"><MessageCircle className="mt-1 size-6 shrink-0 text-[#38BDF8]" /><div><h2 className="font-semibold">WhatsApp</h2><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="transition hover:text-[#25D366]">070 495 0612</a><p className="mt-1 text-sm text-white/40">Talk to our support team in real-time</p><a href={`${WHATSAPP_URL}?text=Hi%20EA%20Migrate%20Pro%20Support`} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-black">Chat on WhatsApp</a></div></div><div className="flex items-start gap-4 rounded-3xl border border-white/10 bg-[#121212] p-5"><MapPin className="mt-1 size-6 shrink-0 text-[#38BDF8]" /><div><h2 className="font-semibold">Office</h2><p>New York, NY</p><p className="text-sm text-white/40">United States</p></div></div></div></div></main>;
}
