import { useState, useEffect, useRef } from "react";
import { Mic, Square, Loader2, Volume2, Type, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

interface VoiceInputProps {
  onTranscriptComplete: (text: string) => void;
  isProcessing?: boolean;
  editMode?: boolean;
}

type InputMode = "voice" | "text";

export function VoiceInput({ onTranscriptComplete, isProcessing, editMode = false }: VoiceInputProps) {
  const [mode, setMode] = useState<InputMode>("voice");
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [textInput, setTextInput] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const shouldBeListeningRef = useRef(false);
  const interimAccRef = useRef("");
  const { toast } = useToast();

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

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
      interimAccRef.current = interim;
      setInterimText(interim || finalTranscript);
      if (finalTranscript) {
        recognition.finalAccumulator =
          (recognition.finalAccumulator || "") + " " + finalTranscript;
        interimAccRef.current = "";
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === "not-allowed" || event.error === "audio-capture") {
        shouldBeListeningRef.current = false;
        setIsRecording(false);
        toast({ title: "Microphone access denied", variant: "destructive" });
      }
      // no-speech / network: let onend handle restart
    };

    recognition.onend = () => {
      if (shouldBeListeningRef.current) {
        // Browser cut off due to silence timeout — restart seamlessly
        try { recognition.start(); } catch {}
        return;
      }
      // User explicitly stopped — process accumulated text
      setIsRecording(false);
      const finalResult = ((recognition.finalAccumulator || "") + " " + interimAccRef.current).trim();
      if (finalResult) onTranscriptComplete(finalResult);
      setInterimText("");
      interimAccRef.current = "";
      recognition.finalAccumulator = "";
    };

    recognitionRef.current = recognition;
    return () => {
      shouldBeListeningRef.current = false;
      recognitionRef.current?.abort();
    };
  }, [onTranscriptComplete, toast]);

  const toggleRecording = () => {
    if (voiceError) {
      toast({ title: "Unsupported", description: voiceError, variant: "destructive" });
      return;
    }
    if (isRecording) {
      shouldBeListeningRef.current = false;
      recognitionRef.current?.stop();
      // setIsRecording(false) will be called by onend
    } else {
      setInterimText("");
      interimAccRef.current = "";
      if (recognitionRef.current) {
        recognitionRef.current.finalAccumulator = "";
        shouldBeListeningRef.current = true;
        try {
          recognitionRef.current.start();
          setIsRecording(true);
        } catch (e) {
          shouldBeListeningRef.current = false;
          console.error(e);
        }
      }
    }
  };

  const handleTextSubmit = () => {
    const text = textInput.trim();
    if (!text) return;
    onTranscriptComplete(text);
    setTextInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleTextSubmit();
    }
  };

  return (
    <div className="relative w-full rounded-2xl bg-card border shadow-sm overflow-hidden">
      {/* Mode toggle */}
      <div className="flex border-b">
        <button
          onClick={() => setMode("voice")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors ${
            mode === "voice"
              ? "bg-primary/5 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <Mic className="w-3.5 h-3.5" />
          Voice
        </button>
        <button
          onClick={() => setMode("text")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors ${
            mode === "text"
              ? "bg-primary/5 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <Type className="w-3.5 h-3.5" />
          Type
        </button>
      </div>

      {/* Voice panel */}
      <AnimatePresence mode="wait">
        {mode === "voice" && (
          <motion.div
            key="voice"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="relative p-6 flex flex-col items-center min-h-[200px] justify-center"
          >
            {isRecording && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-primary/5 pointer-events-none"
              />
            )}

            <div className="relative mb-5">
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
                  <span className="font-medium text-lg text-primary">Parsing your workout...</span>
                  <span className="text-sm mt-1">Structuring exercises, sets, and reps</span>
                </div>
              ) : isRecording ? (
                <div className="w-full">
                  <div className="flex items-center justify-center gap-2 text-primary font-medium mb-2">
                    <Volume2 className="w-4 h-4 animate-pulse" />
                    <span>Listening...</span>
                  </div>
                  <p className="text-lg text-foreground/80 italic break-words">
                    {interimText || "Speak your programme naturally..."}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <h3 className="text-xl font-semibold text-foreground mb-1">Tap to speak</h3>
                  <p className="text-muted-foreground text-sm max-w-sm">
                    e.g.{" "}
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                      "3 by 10 back squat, RPE 8, rest 90 seconds"
                    </span>
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Text panel */}
        {mode === "text" && (
          <motion.div
            key="text"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="p-4 flex flex-col gap-3"
          >
            <Textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={editMode
                ? `Edit the session in plain language, e.g.\n"Change the bench press to 5 sets of 5"\n"Remove the lat pulldown"\n"Add RPE 9 to the deadlift"\n"Move squats to the start"`
                : `Describe the session in plain language, e.g.\n"Back squat 4x6 RPE 8, Romanian deadlift 3x10, leg press 3x15 rest 2 mins"`}
              className="min-h-[130px] resize-none text-sm bg-muted/30 border-transparent hover:border-input focus:bg-background rounded-xl"
              disabled={isProcessing}
              autoFocus
            />
            {editMode && (
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Change X to 4 sets of 8",
                  "Remove X",
                  "Add RPE 9 to X",
                  "Move X to the end",
                  "Swap X for Y",
                  "Set all rests to 2 min",
                ].map(hint => (
                  <button
                    key={hint}
                    type="button"
                    className="text-[10px] bg-muted hover:bg-muted/80 text-muted-foreground rounded-full px-2 py-0.5 transition-colors"
                    onClick={() => setTextInput(hint)}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Tip: <kbd className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">⌘ Enter</kbd> to apply
              </p>
              <Button
                onClick={handleTextSubmit}
                disabled={!textInput.trim() || isProcessing}
                className="rounded-xl gap-2"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                {isProcessing ? "Parsing..." : "Parse"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
