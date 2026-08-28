import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-on-surface">
      <h1 className="text-3xl font-extrabold mb-6">Terms & Conditions</h1>
      <div className="space-y-4 text-on-surface-variant leading-relaxed">
        <p>Welcome to <strong>Samrat Fashion</strong>.</p>
        <h2 className="text-xl font-bold text-on-surface mt-6">1. Orders & Pricing</h2>
        <p>All prices are listed in Indian Rupees (INR) including applicable GST. We reserve the right to decline orders in case of pricing errors or inventory unavailability.</p>
        <h2 className="text-xl font-bold text-on-surface mt-6">2. Custom Apparel Policy</h2>
        <p>Custom printed T-shirts and customer-submitted designs are non-returnable and non-refundable unless received damaged, defective, or incorrect.</p>
        <h2 className="text-xl font-bold text-on-surface mt-6">3. Shipping & Delivery</h2>
        <p>Estimated delivery timelines are provided at checkout. Handoff to courier services occurs after order processing.</p>
        <div className="mt-8 pt-6 border-t border-outline-variant/20">
          <Link href="/" className="text-primary hover:underline font-bold">← Back to Store</Link>
        </div>
      </div>
    </div>
  );
}
