import React, { useState } from 'react';
import './login.css';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const toggleMode = () => setIsLogin(!isLogin);
  const togglePasswordVisibility = () => setShowPassword(!showPassword);

  const Illustration = () => (
    <svg width="100%" height="100%" viewBox="0 0 400 500" fill="none" xmlns="http://www.w3.org/2000/svg" style={{position: 'absolute', top: 0, left: 0}}>
      {/* Swirly background lines */}
      <path d="M -50,300 C 100,400 300,100 450,250" stroke="#ffffff" strokeWidth="1.5" fill="none" opacity="0.6"/>
      <path d="M -50,400 C 150,450 250,250 450,150" stroke="#ffffff" strokeWidth="1" fill="none" opacity="0.4"/>
      <path d="M 50,-50 C 150,150 250,-50 450,150" stroke="#ffffff" strokeWidth="1" fill="none" opacity="0.5"/>
      <circle cx="280" cy="320" r="40" stroke="#ffffff" strokeWidth="1" fill="none" opacity="0.6" />
      <circle cx="250" cy="80" r="4" stroke="#ffffff" strokeWidth="1.5" fill="none" />
      <circle cx="150" cy="420" r="3" fill="#ffffff" />
      
      {/* Abstract shapes - triangles */}
      <polygon points="280,100 290,110 270,110" fill="#FBBF24" />
      <polygon points="210,400 220,380 200,380" fill="#FBBF24" />
      <polygon points="120,250 110,260 110,240" fill="#ffffff" />
      
      {/* Character 1 (Left - Yellow/White) */}
      <g transform="translate(130, 200)">
        {/* Head */}
        <circle cx="0" cy="-30" r="15" fill="#ffffff" />
        <path d="M -10,-45 C -20,-30 5,-15 10,-35" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Body */}
        <path d="M -20,0 C -10,-20 10,-20 20,0 Z" fill="#FBBF24" stroke="#ffffff" strokeWidth="1.5" />
        {/* Arm 1 */}
        <path d="M -15,-5 L -30,10 L -15,15" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Arm 2 */}
        <path d="M 15,-5 L 30,5 L 45,0" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Laptop / Box */}
        <rect x="35" y="-15" width="18" height="25" rx="2" fill="#ffffff" />
        {/* Legs */}
        <path d="M -10,0 L -15,40 L -20,80" stroke="#ffffff" strokeWidth="2" fill="none" />
        <path d="M 5,0 L 15,35 L 5,75" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Feet */}
        <rect x="-25" y="80" width="10" height="8" fill="#FBBF24" />
        <rect x="0" y="75" width="10" height="8" fill="#FBBF24" />
      </g>

      {/* Character 2 (Right - Red/Blue) */}
      <g transform="translate(280, 250)">
        {/* Head */}
        <circle cx="0" cy="-40" r="14" fill="#ffffff" />
        <path d="M -12,-55 C 0,-60 15,-50 12,-40" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Body */}
        <path d="M -22,-10 C -15,-35 15,-35 22,-10 Z" fill="#EF4444" stroke="#ffffff" strokeWidth="1.5" />
        <path d="M -15,-10 L 15,-10 L 0,10 Z" fill="none" stroke="#ffffff" strokeWidth="1.5" />
        {/* Arm 1 */}
        <path d="M -18,-20 L -40,-40 L -50,-35" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Arm 2 */}
        <path d="M 18,-20 L 30,-5 L 25,15" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Legs */}
        <path d="M -10,-10 L -25,20 L -10,50" stroke="#3B82F6" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 10,-10 L 5,20 L 35,30" stroke="#3B82F6" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        {/* Feet */}
        <rect x="-15" y="55" width="10" height="8" fill="#EF4444" />
        <rect x="40" y="30" width="10" height="8" fill="#EF4444" />
      </g>

      {/* Sparkles */}
      <g transform="translate(90, 80) scale(0.5)" stroke="#ffffff" strokeWidth="2">
        <line x1="0" y1="-10" x2="0" y2="10" />
        <line x1="-10" y1="0" x2="10" y2="0" />
        <line x1="-7" y1="-7" x2="7" y2="7" />
        <line x1="-7" y1="7" x2="7" y2="-7" />
      </g>
      <g transform="translate(340, 110) scale(0.4)" stroke="#ffffff" strokeWidth="2">
        <line x1="0" y1="-10" x2="0" y2="10" />
        <line x1="-10" y1="0" x2="10" y2="0" />
        <line x1="-7" y1="-7" x2="7" y2="7" />
        <line x1="-7" y1="7" x2="7" y2="-7" />
      </g>
    </svg>
  );

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-form-section">
          <h2 className="login-title">{isLogin ? 'Sign in' : 'Create an account'}</h2>
          
          <form onSubmit={(e) => e.preventDefault()}>
            {!isLogin && (
              <div className="input-group">
                <label className="input-label">Name</label>
                <div className="input-wrapper">
                  <input type="text" className="input-field" placeholder="John Doe" />
                </div>
              </div>
            )}
            
            <div className="input-group">
              <label className="input-label">Email</label>
              <div className="input-wrapper">
                <input type="email" className="input-field" placeholder="example.email@gmail.com" />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Password</label>
              <div className="input-wrapper">
                <input 
                  type={showPassword ? "text" : "password"} 
                  className="input-field" 
                  placeholder="Enter at least 8+ characters" 
                />
                <button type="button" className="password-toggle" onClick={togglePasswordVisibility}>
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {isLogin && (
              <div className="form-options">
                <label className="checkbox-label">
                  <input type="checkbox" className="checkbox-input" />
                  Remember me
                </label>
                <a href="#" className="forgot-password">Forgot password?</a>
              </div>
            )}

            <button type="submit" className="submit-btn">{isLogin ? 'Sign in' : 'Register'}</button>
          </form>

          <div className="divider">Or {isLogin ? 'sign in' : 'register'} with</div>

          <div className="social-login">
            <button type="button" className="social-btn google-btn">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#EA4335"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#EA4335"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#EA4335"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </button>
          </div>

          <div className="toggle-mode">
            {isLogin ? "Don't have an account?" : "Already have an account?"} 
            <button type="button" className="toggle-mode-btn" onClick={toggleMode}>
              {isLogin ? 'Register' : 'Sign in'}
            </button>
          </div>
        </div>

        <div className="login-illustration-section">
          <Illustration />
        </div>
      </div>
    </div>
  );
}
