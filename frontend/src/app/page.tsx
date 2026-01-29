"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Sparkles,
  Heart,
  Zap,
  Brain,
  Activity,
  Info,
  Stethoscope,
  FileText,
  Loader2,
} from "lucide-react";

interface Procedure {
  procedure_name: string;
  similarity_score: number;
  steps?: any[];
}

interface ApiResponse {
  response: string;
  query: string;
  retrieved_procedures: Procedure[];
}

const exampleQueries = [
  { icon: Heart, label: "CPR Guide", query: "How to give CPR to a child?" },
  { icon: Activity, label: "Vertigo Help", query: "How to perform epley maneuver for vertigo?" },
  { icon: Zap, label: "AED Steps", query: "How to use an AED?" },
  { icon: Brain, label: "Shock Care", query: "How to treat someone in shock?" },
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || isLoading) return;

    setIsLoading(true);
    setApiResponse(null);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setApiResponse(data);
      setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (error) {
      console.error("Error:", error);
      setApiResponse({
        query,
        response: "Sorry, an error occurred while fetching the answer. Please check the console or try again.",
        retrieved_procedures: [],
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleExampleQuery = (exampleQuery: string) => {
    setQuery(exampleQuery);
    setTimeout(() => {
      const submitButton = document.getElementById("submit-button") as HTMLButtonElement;
      submitButton?.click();
    }, 100);
  };

  return (
    <main className="min-h-screen w-full bg-gradient-to-b from-slate-50 to-blue-50">
      {/* Hero Section */}
      <section className="w-full px-6 pt-20 pb-16 md:pt-32 md:pb-24">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center justify-center w-20 h-20 mb-8 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/30">
              <Stethoscope size={40} className="text-white" />
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-gray-900 mb-6">
              Medical Procedure
              <span className="block bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Q&A Assistant
              </span>
            </h1>
            
            <p className="text-xl md:text-2xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Get instant, AI-powered answers to your medical procedure questions with step-by-step guidance.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Search Section */}
      <section className="w-full px-6 pb-12">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <form onSubmit={handleSubmit} className="relative">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-grow">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask a medical procedure question..."
                    className="w-full pl-14 pr-6 py-5 text-lg rounded-2xl shadow-lg input-field"
                  />
                </div>
                <button
                  id="submit-button"
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary px-8 py-5 text-lg flex items-center justify-center gap-3"
                >
                  {isLoading ? (
                    <Loader2 size={24} className="animate-spin" />
                  ) : (
                    <>
                      <Sparkles size={24} />
                      <span>Ask AI</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Example Queries */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <span className="text-gray-500 font-medium">Try asking:</span>
              {exampleQueries.map((item) => (
                <button
                  key={item.label}
                  onClick={() => handleExampleQuery(item.query)}
                  className="flex items-center gap-2 px-5 py-3 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-full transition-all duration-200 shadow-sm hover:shadow-md text-gray-700 hover:text-blue-600"
                >
                  <item.icon size={18} />
                  <span className="font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Results Section */}
      <section className="w-full px-6 pb-20">
        <div className="max-w-4xl mx-auto">
          <AnimatePresence>
            {isLoading && !apiResponse && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center py-20"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-blue-100">
                  <Loader2 className="animate-spin text-blue-600" size={32} />
                </div>
                <p className="text-xl text-gray-600">Analyzing your question...</p>
                <p className="text-gray-400 mt-2">This may take a few seconds</p>
              </motion.div>
            )}

            {apiResponse && (
              <motion.div
                id="results"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="space-y-8"
              >
                {/* AI Response Card */}
                <div className="card-panel p-8 md:p-12">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                      <Sparkles className="text-white" size={24} />
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold text-gray-900">
                      AI-Generated Answer
                    </h2>
                  </div>
                  <div
                    className="text-lg md:text-xl text-gray-700 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: apiResponse.response.replace(/\n/g, '<br />') }}
                  />
                </div>

                {/* Retrieved Procedures */}
                {apiResponse.retrieved_procedures && apiResponse.retrieved_procedures.length > 0 && (
                  <div className="card-panel p-8 md:p-12">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center">
                        <FileText className="text-white" size={24} />
                      </div>
                      <h2 className="text-2xl md:text-3xl font-bold text-gray-900">
                        Related Procedures
                      </h2>
                    </div>
                    <div className="space-y-4">
                      {apiResponse.retrieved_procedures.map((proc, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3, delay: index * 0.1 }}
                          className="info-card p-6 flex justify-between items-center"
                        >
                          <div>
                            <p className="text-lg font-semibold text-gray-900">{proc.procedure_name}</p>
                            {proc.steps && (
                              <p className="text-gray-500 mt-1">{proc.steps.length} steps available</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold text-blue-600">
                              {Math.round(proc.similarity_score * 100)}%
                            </p>
                            <p className="text-sm text-gray-500">Match</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Disclaimer */}
                <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6 md:p-8">
                  <div className="flex items-center gap-3 text-amber-800 mb-3">
                    <Info size={24} />
                    <p className="text-lg font-bold">Important Medical Disclaimer</p>
                  </div>
                  <p className="text-amber-700 text-lg">
                    This AI assistant provides general educational information only. Always consult with qualified healthcare professionals for medical advice, diagnosis, or treatment.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </main>
  );
}
