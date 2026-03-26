import { Printer, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Exercise } from "@workspace/api-client-react";
import { useState } from "react";
import { format } from "date-fns";

interface PreviewPanelProps {
  title: string;
  exercises: Exercise[];
}

export function PreviewPanel({ title, exercises }: PreviewPanelProps) {
  const [copied, setCopied] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = async () => {
    let text = `${title || 'Training Programme'}\n\n`;
    
    exercises.forEach((ex, index) => {
      text += `${index + 1}. ${ex.name.toUpperCase()}\n`;
      text += `   Sets: ${ex.sets || '-'} | Reps: ${ex.reps || '-'}\n`;
      
      const meta = [];
      if (ex.rpe) meta.push(`RPE: ${ex.rpe}`);
      if (ex.rest) meta.push(`Rest: ${ex.rest}`);
      if (ex.tempo) meta.push(`Tempo: ${ex.tempo}`);
      if (meta.length > 0) text += `   ${meta.join(' | ')}\n`;
      
      if (ex.notes) text += `   Notes: ${ex.notes}\n`;
      
      if (ex.weekProgression && ex.weekProgression.length > 0) {
        text += `   Progression:\n`;
        ex.weekProgression.forEach(w => {
          text += `     W${w.week}: ${w.sets || ex.sets || '-'}x${w.reps || ex.reps || '-'} @ ${w.rpe || w.weight || ex.rpe || '-'}\n`;
        });
      }
      text += '\n';
    });

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-50/50">
      {/* Tools Header (Hidden on Print) */}
      <div className="flex items-center justify-between p-4 border-b bg-background/50 backdrop-blur-sm sticky top-0 z-20 no-print">
        <h2 className="text-sm font-semibold text-muted-foreground tracking-widest uppercase">Live Preview</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} className="bg-white hover:bg-slate-50 border-slate-200 shadow-sm rounded-lg">
            {copied ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
            {copied ? 'Copied' : 'Copy Text'}
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} className="bg-white hover:bg-slate-50 border-slate-200 shadow-sm rounded-lg">
            <Printer className="w-4 h-4 mr-2" />
            Print / PDF
          </Button>
        </div>
      </div>

      {/* The Document */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 no-print-padding">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl border border-slate-200 p-8 md:p-12 print:shadow-none print:border-none print:p-0">
          
          <header className="mb-10 border-b-2 border-slate-900 pb-6">
            <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight leading-tight">
              {title || "Untitled Programme"}
            </h1>
            <p className="text-slate-500 mt-2 font-medium">
              Generated {format(new Date(), 'MMMM d, yyyy')}
            </p>
          </header>

          {exercises.length === 0 ? (
            <div className="py-20 text-center text-slate-400 italic">
              Programme is empty. Add exercises to see preview.
            </div>
          ) : (
            <div className="space-y-10">
              {exercises.map((exercise, idx) => (
                <div key={exercise.id} className="group break-inside-avoid">
                  
                  {/* Exercise Header */}
                  <div className="flex items-baseline gap-4 mb-3">
                    <span className="text-2xl font-display font-bold text-slate-300 select-none">
                      {(idx + 1).toString().padStart(2, '0')}
                    </span>
                    <h3 className="text-2xl font-bold text-slate-900 uppercase tracking-tight">
                      {exercise.name || "UNNAMED EXERCISE"}
                    </h3>
                  </div>

                  {/* Primary Metrics Row */}
                  <div className="pl-11">
                    <div className="inline-flex items-center gap-6 p-3 bg-slate-50 rounded-xl border border-slate-100 mb-4 pr-8">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Volume</span>
                        <span className="text-lg font-extrabold text-slate-900">
                          {exercise.sets || '-'} <span className="text-slate-400 font-normal mx-1">×</span> {exercise.reps || '-'}
                        </span>
                      </div>
                      
                      {(exercise.rpe || exercise.rest || exercise.tempo) && (
                        <div className="w-px h-8 bg-slate-200 mx-2"></div>
                      )}

                      {exercise.rpe && (
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">RPE</span>
                          <span className="text-sm font-bold text-slate-700">{exercise.rpe}</span>
                        </div>
                      )}
                      
                      {exercise.rest && (
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Rest</span>
                          <span className="text-sm font-bold text-slate-700">{exercise.rest}</span>
                        </div>
                      )}

                      {exercise.tempo && (
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Tempo</span>
                          <span className="text-sm font-bold text-slate-700">{exercise.tempo}</span>
                        </div>
                      )}
                    </div>

                    {/* Notes */}
                    {exercise.notes && (
                      <div className="mb-4 text-slate-600 bg-blue-50/50 p-4 rounded-xl border-l-4 border-blue-400">
                        <p className="italic text-sm">{exercise.notes}</p>
                      </div>
                    )}

                    {/* Week Progression Table */}
                    {exercise.weekProgression && exercise.weekProgression.length > 0 && (
                      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-2 w-24">Week</th>
                              <th className="px-4 py-2">Sets</th>
                              <th className="px-4 py-2">Reps</th>
                              <th className="px-4 py-2">Target/RPE</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {exercise.weekProgression.map(week => (
                              <tr key={week.week} className="bg-white">
                                <td className="px-4 py-2 font-medium text-slate-900">Week {week.week}</td>
                                <td className="px-4 py-2 text-slate-600">{week.sets || exercise.sets || '-'}</td>
                                <td className="px-4 py-2 text-slate-600">{week.reps || exercise.reps || '-'}</td>
                                <td className="px-4 py-2 text-slate-600 font-medium">{week.rpe || week.weight || exercise.rpe || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                </div>
              ))}
            </div>
          )}
          
          <div className="mt-16 pt-8 border-t border-slate-100 text-center print-only hidden">
            <p className="text-xs text-slate-400">Created with Cue Coaching</p>
          </div>
        </div>
      </div>
    </div>
  );
}
