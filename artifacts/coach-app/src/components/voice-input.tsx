import { useState, useEffect, useRef } from "react";
import { Mic, Square, Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

interface VoiceInputProps {
  onTranscriptComplete: (text: string) => void;
  isProcessing?: boolean;
}

export function VoiceInput({ onTranscriptComplete, isProcessing }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Check for browser support
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      setInterimText(interim || finalTranscript);
      
      // If we got a final chunk, we could accumulate it, 
      // but for UX, we'll let the user stop to process the whole thing.
      if (finalTranscript) {
        recognitionRef.current.finalAccumulator = (recognitionRef.current.finalAccumulator || "") + " " + finalTranscript;
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsRecording(false);
      if (event.error === 'not-allowed') {
        toast({
          title: "Microphone Access Denied",
          description: "Please allow microphone access to use voice commands.",
          variant: "destructive",
        });
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
      const finalResult = (recognitionRef.current.finalAccumulator || "") + " " + interimText;
      const cleanResult = finalResult.trim();
      
      if (cleanResult) {
        onTranscriptComplete(cleanResult);
      }
      
      setInterimText("");
      if (recognitionRef.current) {
        recognitionRef.current.finalAccumulator = "";
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [onTranscriptComplete, toast]);

  const toggleRecording = () => {
    if (error) {
      toast({ title: "Unsupported", description: error, variant: "destructive" });
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      setInterimText("");
      if (recognitionRef.current) {
        recognitionRef.current.finalAccumulator = "";
        try {
          recognitionRef.current.start();
          setIsRecording(true);
        } catch (e) {
          console.error(e);
        }
      }
    }
  };

  return (
    <div className="relative w-full rounded-2xl bg-card border shadow-sm p-6 flex flex-col items-center justify-center min-h-[200px] transition-all duration-300">
      
      {/* Background Pulse Effect when recording */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute inset-0 bg-primary/5 rounded-2xl pointer-events-none"
          />
        )}
      </AnimatePresence>

      <div className="relative z-10 flex flex-col items-center w-full max-w-xl mx-auto">
        <div className="relative mb-6">
          {isRecording && (
            <>
              <motion.div 
                animate={{ scale: [1, 1.4, 1] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                className="absolute inset-0 bg-primary/20 rounded-full"
              />
              <motion.div 
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 2, delay: 0.2, ease: "easeInOut" }}
                className="absolute inset-0 bg-primary/30 rounded-full"
              />
            </>
          )}
          
          <Button
            size="icon"
            className={`w-20 h-20 rounded-full shadow-xl transition-all duration-300 z-10 relative ${
              isRecording 
                ? "bg-destructive hover:bg-destructive/90 shadow-destructive/25 text-white" 
                : "bg-primary hover:bg-primary/90 shadow-primary/25 text-white"
            } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={toggleRecording}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : isRecording ? (
              <Square className="w-8 h-8 fill-current" />
            ) : (
              <Mic className="w-8 h-8" />
            )}
          </Button>
        </div>

        <div className="text-center min-h-[60px] w-full">
          {isProcessing ? (
            <div className="flex flex-col items-center text-muted-foreground animate-pulse">
              <span className="font-medium text-lg text-primary">AI is parsing your workout...</span>
              <span className="text-sm mt-1">Structuring exercises, sets, and reps</span>
            </div>
          ) : isRecording ? (
            <div className="w-full">
              <div className="flex items-center justify-center gap-2 text-primary font-medium mb-2">
                <Volume2 className="w-4 h-4 animate-pulse" />
                <span>Listening...</span>
              </div>
              <p className="text-lg text-foreground/80 italic w-full break-words">
                {interimText || "Speak your programme naturally..."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <h3 className="text-xl font-display font-semibold text-foreground mb-1">
                Tap to speak
              </h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                Say things like <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">"3 by 10 back squat, RPE 8, rest 90 seconds"</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
