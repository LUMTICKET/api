"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="bg-white p-10 rounded-2xl shadow-lg max-w-md w-full">
          <h2 className="text-xl font-semibold text-center">Loading...</h2>
          <div className="mt-4 w-10 h-10 border-4 border-gray-200 border-t-4 border-t-amber-500 rounded-full animate-spin mx-auto" />
        </div>
      </div>
    }>
      <AcceptInvitationContent />
    </Suspense>
  );
}

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step, setStep] = useState<"loading" | "verify" | "success">("loading");

  useEffect(() => {
    if (token) {
      verifyInvitation();
    }
  }, [token]);

  const verifyInvitation = async () => {
    try {
      const res = await fetch(`/api/team/verify?token=${token}`);
      const data = await res.json();
      if (res.ok) {
        setInvitation(data);
        setStep("verify");
      } else {
        setError(data.error || "Invalid invitation");
      }
    } catch {
      setError("Failed to verify invitation");
    }
  };

  const handleAccept = async () => {
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("token", data.token);
        setStep("success");
        setTimeout(() => router.push("/dashboard"), 2000);
      } else {
        setError(data.error || "Failed to accept invitation");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (step === "loading") {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="bg-white p-10 rounded-2xl shadow-lg max-w-md w-full">
          <h2 className="text-xl font-semibold text-center">Verifying Invitation...</h2>
          <div className="mt-4 w-10 h-10 border-4 border-gray-200 border-t-4 border-t-amber-500 rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="bg-white p-10 rounded-2xl shadow-lg max-w-md w-full">
          <h2 className="text-2xl font-bold text-center text-green-600">✓ Successfully Joined!</h2>
          <p className="text-center mt-2 text-gray-700">
            You are now a member of {invitation?.businessName}
          </p>
          <p className="text-center mt-2 text-sm text-gray-500">
            Redirecting to dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-50 p-5">
      <div className="bg-white p-10 rounded-2xl shadow-lg max-w-md w-full">
        <h2 className="text-2xl font-bold text-center mb-6">Join Team</h2>
        
        {invitation && (
          <div className="bg-gray-100 p-4 rounded-lg mb-6">
            <p className="text-gray-700">
              <strong>{invitation.invitedByName}</strong> invited you to join{" "}
              <strong>{invitation.businessName}</strong> as a{" "}
              <strong>{invitation.role}</strong>
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Email: {invitation.email}
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">
              {error}
            </div>
          )}

          <button
            onClick={handleAccept}
            disabled={loading}
            className="w-full bg-amber-500 text-black font-semibold py-3 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
          >
            {loading ? "Accepting..." : "Accept Invitation"}
          </button>
        </div>
      </div>
    </div>
  );
}