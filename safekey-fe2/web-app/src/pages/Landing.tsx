
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'

export default function Landing() {
  const navigate = useNavigate()
  const [particles, setParticles] = useState<Array<{ id: number; left: number; top: number; delay: number; duration: number }>>([])

  useEffect(() => {
    // Generate particles
    const newParticles = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 100,
      delay: Math.random() * 5,
      duration: 15 + Math.random() * 10,
    }))
    setParticles(newParticles)
  }, [])

  return (
    <div style={{ background: '#0a0a0a', color: '#ffffff', minHeight: '100vh', position: 'relative', overflowX: 'hidden' }}>
      {/* Animated Background */}
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}>
        {particles.map((p) => (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: '2px',
              height: '2px',
              background: 'rgba(191, 255, 11, 0.3)',
              borderRadius: '50%',
              animation: `float ${p.duration}s linear infinite`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translate(0, 0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translate(0, 100px); opacity: 0; }
        }
      `}</style>

      {/* Header */}
      <header style={{ padding: '2rem 0', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>SafeKey</div>
          <button
            onClick={() => navigate('/login')}
            style={{
              background: 'transparent',
              border: '1px solid rgba(191, 255, 11, 0.5)',
              color: '#bfff0b',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              fontSize: '0.95rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              fontFamily: 'Satoshi, sans-serif',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(191, 255, 11, 0.1)'
              e.currentTarget.style.borderColor = '#bfff0b'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.borderColor = 'rgba(191, 255, 11, 0.5)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            Get Started
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section style={{ padding: '8rem 0 6rem', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem' }}>
          <div style={{ maxWidth: '800px' }}>
            <h1 style={{ fontSize: 'clamp(3rem, 8vw, 6rem)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: '1.5rem' }}>
              Decentralized Password Manager.<br />
              <span style={{ color: '#bfff0b' }}>For Humans.</span>
            </h1>
            <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '2rem', letterSpacing: '0.05em' }}>
              /// DECENTRALIZED. ENCRYPTED. YOURS.
            </p>
            <p style={{ fontSize: '1.25rem', lineHeight: 1.6, color: 'rgba(255, 255, 255, 0.8)', marginBottom: '3rem', maxWidth: '600px' }}>
              Store your passwords on the blockchain, encrypted. No company controls your data. No servers to hack. 
              Just you, your email, and your passwords. Simple, secure, and truly yours.
            </p>
            <button
              onClick={() => navigate('/login')}
              style={{
                background: '#bfff0b',
                color: '#0a0a0a',
                border: 'none',
                padding: '1.25rem 3rem',
                borderRadius: '0.5rem',
                fontSize: '1.1rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontFamily: 'Satoshi, sans-serif',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)'
                e.currentTarget.style.boxShadow = '0 10px 40px rgba(191, 255, 11, 0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              Start Protecting Your Passwords
            </button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section style={{ padding: '6rem 0', borderTop: '1px solid rgba(255, 255, 255, 0.1)', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem' }}>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '1rem', letterSpacing: '0.05em' }}>
            /// WHAT YOU GET
          </p>
          <h2 style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '4rem' }}>
            Built for <span style={{ color: '#bfff0b' }}>Humans</span>
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '3rem' }}>
            {[
              {
                title: 'You Own It',
                description: 'Your passwords live on the blockchain. No company controls your data. No leaks. No breaches. Just you.',
              },
              {
                title: 'No Seed Phrases',
                description: 'Just sign in with your email. We handle the encryption. You handle your passwords. Simple.',
              },
              {
                title: 'Auto-Fill Everywhere',
                description: 'Install our browser extension. It fills your passwords automatically, just like other password managers.',
              },
              {
                title: 'Hacker-Proof',
                description: 'Even if someone hacks the blockchain, they can\'t decrypt your passwords. Only you can.',
              },
            ].map((feature, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '0.75rem',
                  padding: '2rem',
                  transition: 'all 0.3s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-5px)'
                  e.currentTarget.style.borderColor = 'rgba(191, 255, 11, 0.3)'
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
                }}
              >
                <h3 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', letterSpacing: '-0.01em', color: '#bfff0b' }}>
                  {feature.title}
                </h3>
                <p style={{ fontSize: '1rem', lineHeight: 1.6, color: 'rgba(255, 255, 255, 0.7)' }}>
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section style={{ padding: '6rem 0', borderTop: '1px solid rgba(255, 255, 255, 0.1)', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem' }}>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '1rem', letterSpacing: '0.05em' }}>
            /// HOW IT WORKS
          </p>
          <h2 style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '4rem' }}>
            Three Steps to <span style={{ color: '#bfff0b' }}>Security</span>
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '3rem' }}>
            {[
              {
                number: '01',
                title: 'Sign In',
                description: 'Use your email to sign in. No passwords to remember. No seed phrases to lose.',
              },
              {
                number: '02',
                title: 'Save Passwords',
                description: 'Add passwords manually or let the extension save them automatically when you log in to websites.',
              },
              {
                number: '03',
                title: 'Auto-Fill',
                description: 'The extension fills your passwords automatically. Just click and go. No typing, no mistakes.',
              },
            ].map((step, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '3rem', fontWeight: 700, color: 'rgba(191, 255, 11, 0.2)', marginBottom: '1rem' }}>
                  {step.number}
                </div>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', letterSpacing: '-0.01em' }}>
                  {step.title}
                </h3>
                <p style={{ fontSize: '1rem', lineHeight: 1.6, color: 'rgba(255, 255, 255, 0.7)' }}>
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section style={{ padding: '8rem 0', borderTop: '1px solid rgba(255, 255, 255, 0.1)', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
            <h2 style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>
              Ready to Own Your Passwords?
            </h2>
            <p style={{ fontSize: '1.25rem', lineHeight: 1.6, color: 'rgba(255, 255, 255, 0.7)', marginBottom: '3rem' }}>
              Join thousands of people who've taken control of their digital security.
            </p>
            <button
              onClick={() => navigate('/login')}
              style={{
                background: '#bfff0b',
                color: '#0a0a0a',
                border: 'none',
                padding: '1.25rem 3rem',
                borderRadius: '0.5rem',
                fontSize: '1.1rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontFamily: 'Satoshi, sans-serif',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)'
                e.currentTarget.style.boxShadow = '0 10px 40px rgba(191, 255, 11, 0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              Get Started Free
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '3rem 0', borderTop: '1px solid rgba(255, 255, 255, 0.1)', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>SafeKey</div>
              <p style={{ color: 'rgba(255, 255, 255, 0.5)', marginTop: '0.5rem' }}>Your vault. Your keys. Your control.</p>
            </div>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <a href="#" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none', transition: 'color 0.3s ease' }} onMouseEnter={(e) => e.currentTarget.style.color = '#bfff0b'} onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'}>Twitter</a>
              <a href="#" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none', transition: 'color 0.3s ease' }} onMouseEnter={(e) => e.currentTarget.style.color = '#bfff0b'} onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'}>Discord</a>
              <a href="#" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none', transition: 'color 0.3s ease' }} onMouseEnter={(e) => e.currentTarget.style.color = '#bfff0b'} onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'}>Docs</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
