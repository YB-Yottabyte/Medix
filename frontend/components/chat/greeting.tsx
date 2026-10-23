import { motion } from "motion/react";

export const Greeting = () => (
  <div className="flex flex-col items-center px-4" key="overview">
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="text-balance text-center font-medium text-[22px] text-foreground tracking-[-0.035em] sm:text-[28px]"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.12, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      How can I help you?
    </motion.div>
  </div>
);
