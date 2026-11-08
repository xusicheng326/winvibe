import React from 'react';
import { motion } from 'framer-motion';

interface AuraGlowProps {
  status: 'idle' | 'running' | 'waiting' | 'completed' | 'error';
  isHovered: boolean;
  hasWaiting: boolean;
}

export const AuraGlow: React.FC<AuraGlowProps> = ({ status, isHovered, hasWaiting }) => {
  let glowColor = 'from-transparent via-cyan-500/20 to-transparent';
  let pulseSpeed = 2.5;

  if (hasWaiting || status === 'waiting') {
    glowColor = 'from-transparent via-amber-400/40 to-transparent';
    pulseSpeed = 1.2;
  } else if (status === 'running') {
    glowColor = 'from-transparent via-cyan-400/35 to-transparent';
    pulseSpeed = 2.0;
  } else if (status === 'error') {
    glowColor = 'from-transparent via-rose-500/40 to-transparent';
    pulseSpeed = 1.5;
  } else if (status === 'completed') {
    glowColor = 'from-transparent via-emerald-400/30 to-transparent';
    pulseSpeed = 3.0;
  }

  return (
    <div className="absolute -inset-[1.5px] rounded-full pointer-events-none overflow-hidden -z-10">
      <motion.div
        animate={{
          x: ['-100%', '100%'],
          opacity: isHovered || hasWaiting ? [0.4, 0.8, 0.4] : [0.2, 0.5, 0.2],
        }}
        transition={{
          repeat: Infinity,
          duration: pulseSpeed,
          ease: 'linear',
        }}
        className={`w-full h-full bg-gradient-to-r ${glowColor} blur-[2px]`}
      />
    </div>
  );
};
