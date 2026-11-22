import React from "react";
import { LegalDocument } from "@/components/LegalDocument";

// DRAFT. Describes the rules the app already enforces. To be reviewed by counsel and completed.
const SECTIONS = [
  {
    heading: "1. Who can use Dateza",
    body: "You must be at least 18 years old and enter your real date of birth. Dateza checks this when you sign up and may close accounts that do not meet it.",
  },
  {
    heading: "2. Be yourself",
    body: "Use your own name and your own photos. Do not create an account for someone else or pretend to be another person.",
  },
  {
    heading: "3. Treat people with respect",
    body: "Do not harass, threaten or abuse other members, and do not send spam or unwanted explicit content. Tools to report and block members are not available in the app yet.",
  },
  {
    heading: "4. Your account",
    body: "Keep your password private. You are responsible for what happens under your account. Dateza can suspend or close accounts that break these rules.",
  },
  {
    heading: "5. Your content",
    body: "You keep ownership of the photos and text you add. You allow Dateza to store and show them to other members as part of the service.",
  },
  {
    heading: "6. About this text",
    body: "These terms are an early draft. They are incomplete and are not yet a finished legal agreement. Final terms will be published after legal review.",
  },
];

export default function TermsScreen() {
  return <LegalDocument title="Terms of Service" sections={SECTIONS} />;
}
