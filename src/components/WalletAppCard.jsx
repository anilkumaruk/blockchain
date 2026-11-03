import { useEffect, useState } from 'react';
import { KeyRound, Smartphone } from 'lucide-react';

/**
 * The student wallet: this portal installs on a phone as an app (PWA), and the
 * student holds the key to each certificate's encrypted copy on IPFS. The key
 * travels only inside the QR code, so the student decides who can read it.
 */
export default function WalletAppCard() {
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5 grid sm:grid-cols-2 gap-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Smartphone size={16} className="text-teal" aria-hidden="true" /> Your credential wallet</h2>
        <p className="text-xs text-ink-soft mt-1">
          {installed
            ? 'Installed on this device.'
            : installEvent
              ? 'Install this portal as an app on your phone.'
              : 'On a phone: open the browser menu and choose "Add to Home Screen" to use this portal as an app.'}
        </p>
        {installEvent && !installed && (
          <button onClick={install} className="mt-3 text-sm font-medium bg-teal text-white rounded-md px-3.5 py-1.5 hover:bg-teal/90">
            Install app
          </button>
        )}
      </div>
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><KeyRound size={16} className="text-teal" aria-hidden="true" /> You control who reads it</h2>
        <p className="text-xs text-ink-soft mt-1">
          Each marks card is stored on IPFS, encrypted. The key is only inside the QR code on your downloaded card: whoever you give it to can check it
          against the Ethereum smart contract without asking anyone else.
        </p>
      </div>
    </div>
  );
}
