import type { Metadata } from "next";
import DashboardClient from "@/components/DashboardClient";

export const metadata: Metadata = {
  title: "RingWatch — Fraud Ring Detection Dashboard",
  description:
    "RingWatch surfaces hidden transaction ring networks before chargebacks land. Built for Razorpay Buildathon Track 02: AI Risk Manager.",
  keywords: [
    "fraud detection",
    "ring detection",
    "chargeback prevention",
    "graph analysis",
    "Razorpay",
    "fintech",
  ],
};

export default function HomePage() {
  return (
    <main>
      <DashboardClient />
    </main>
  );
}
