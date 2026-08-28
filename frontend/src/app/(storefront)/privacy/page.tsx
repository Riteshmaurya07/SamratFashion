import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-on-surface">
      <h1 className="text-3xl font-extrabold mb-6">Privacy Policy</h1>
      <div className="space-y-4 text-on-surface-variant leading-relaxed">
        <p><strong>Effective Date:</strong> August 29, 2026</p>
        <p>At <strong>Samrat Fashion</strong> (operating as Threadvibe Clothing India), we prioritize the privacy and security of your personal data.</p>
        <h2 className="text-xl font-bold text-on-surface mt-6">1. Information We Collect</h2>
        <p>We collect information required to fulfill orders, including name, phone number, shipping address, email, and transaction IDs provided during checkout.</p>
        <h2 className="text-xl font-bold text-on-surface mt-6">2. Payment Security</h2>
        <p>All payments are processed securely through Razorpay. We do not store credit/debit card details or banking passwords on our servers.</p>
        <h2 className="text-xl font-bold text-on-surface mt-6">3. Use of Information</h2>
        <p>Your data is used solely for order processing, logistics fulfillment, customer support, and essential transactional notifications.</p>
        <div className="mt-8 pt-6 border-t border-outline-variant/20">
          <Link href="/" className="text-primary hover:underline font-bold">← Back to Store</Link>
        </div>
      </div>
    </div>
  );
}
