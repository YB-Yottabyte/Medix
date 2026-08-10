import { motion } from "framer-motion";

export const Greeting = () => {
  return (
    <div className="flex flex-col items-center px-4" key="overview">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-balance text-center text-[26px] font-semibold tracking-[-0.035em] text-foreground sm:text-[30px]"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.12, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        What can Medix help with?
      </motion.div>
    </div>
  );
};
