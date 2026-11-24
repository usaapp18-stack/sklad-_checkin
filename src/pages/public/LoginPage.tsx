import React, { useState } from 'react';
import { LoginScreen } from '../../components/auth/LoginScreen';
import { RegistrationView } from '../../components/employee/RegistrationView';
import { navigate } from '../../utils/router';
import { ArrowRight } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);

  return (
    <div className="bg-[#f7f9ff] flex-1 flex flex-col items-center justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-sm space-y-4">
        <LoginScreen onOpenRegistration={() => setIsRegistrationOpen(true)} embedded />

        <div className="text-center">
          <a
            href="/register"
            onClick={e => {
              e.preventDefault();
              navigate('/register');
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2f63ff] hover:text-[#1f4fe0] hover:underline transition-colors"
          >
            <span>Создать кабинет руководителя (7 дней бесплатно)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <RegistrationView isOpen={isRegistrationOpen} onClose={() => setIsRegistrationOpen(false)} />
    </div>
  );
};
