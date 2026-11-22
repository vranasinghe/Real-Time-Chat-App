import React from "react";
import { LegalDocument } from "@/components/LegalDocument";

// DRAFT. Every sentence describes what the app does today; nothing promises more. To be reviewed by counsel.
const SECTIONS = [
  {
    heading: "1. What we store about you",
    body: "Your email address, name, date of birth, gender, who you are interested in, what you are looking for (if you chose to say), photos, interests, bio, height and age range (if you added them), the messages and photos you send in chats, the statuses you post, and your likes and passes. We also store your hashed password (never the password itself), one-time codes used to verify your email or reset your password, and a record of the policy versions you accepted and when.",
  },
  {
    heading: "2. How it is used",
    body: "To run Dateza: to create your account, keep it secure, show your profile to other eligible members, suggest people to you, deliver your messages and let you sign in. Your exact date of birth is used only to check that you are 18 or over and to show your age; it is not shown to others.",
  },
  {
    heading: "3. Who can see it",
    body: "Other members can see the profile details you added, your photos and your age. Only the people you are matched with can read your messages and chat photos. Chat photos and statuses disappear after 12 hours. Dateza staff can access stored data to operate and secure the service. Verification emails are sent through an email delivery provider. If you sign in with Google, Google tells us your name and verified email address.",
  },
  {
    heading: "4. Location",
    body: "Dateza does not collect or store your location at this time, and nothing in the app shows other members how far away you are.",
  },
  {
    heading: "5. Tracking and advertising",
    body: "This version of the app contains no advertising or analytics tools.",
  },
  {
    heading: "6. Security",
    body: "Passwords are stored hashed. On the web your session is kept in a cookie that scripts cannot read; in the mobile app it is kept in the device's secure storage. Connections use HTTPS. No system is perfectly secure.",
  },
  {
    heading: "7. Your choices and what is not available yet",
    body: "You can edit your profile and change your password in the app. Deleting your account and downloading your data are not available in the app yet; these features are being built, and retention periods will be stated here once they are decided. Until then, contact support for any request about your data.",
  },
  {
    heading: "8. Age limit",
    body: "Dateza is only for people aged 18 and over. If you enter a date of birth that shows you are younger, you cannot continue.",
  },
];

export default function PrivacyPolicyScreen() {
  return <LegalDocument title="Privacy Policy" sections={SECTIONS} />;
}
