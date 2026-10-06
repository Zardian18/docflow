import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { AuthCard } from './AuthCard';

// Self-service reset emails arrive with real email delivery (Phase 5). Until then an
// administrator issues a one-time link from Employee Master (D16).
export function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Ask your administrator for a password link. They can send you one from Employee Master, and it stays valid for 3 days."
    >
      <Button asChild variant="outline" className="h-10 w-full">
        <Link to="/login">Back to sign in</Link>
      </Button>
    </AuthCard>
  );
}
