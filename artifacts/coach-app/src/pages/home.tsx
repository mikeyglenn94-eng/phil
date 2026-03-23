import { Link } from "wouter";
import { Plus, Clock, Dumbbell, List, Mic, MoreVertical, Copy, Trash2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useListProgrammes, useDeleteProgramme, useDuplicateProgramme, getListProgrammesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Home() {
  const { data: programmes, isLoading } = useListProgrammes();
  const deleteMutation = useDeleteProgramme();
  const duplicateMutation = useDuplicateProgramme();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this programme?")) {
      try {
        await deleteMutation.mutateAsync({ id });
        queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
        toast({ title: "Programme deleted" });
      } catch (err) {
        toast({ title: "Error deleting programme", variant: "destructive" });
      }
    }
  };

  const handleDuplicate = async (id: number) => {
    try {
      await duplicateMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      toast({ title: "Programme duplicated successfully" });
    } catch (err) {
      toast({ title: "Error duplicating programme", variant: "destructive" });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background min-h-screen">
      <div className="max-w-6xl mx-auto p-6 md:p-10">
        
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <h1 className="text-4xl md:text-5xl font-display font-extrabold text-foreground tracking-tight mb-2">
              Dashboard
            </h1>
            <p className="text-muted-foreground text-lg">
              Manage your training programmes and voice notes.
            </p>
          </div>
          
          <Link href="/programmes/new">
            <Button size="lg" className="rounded-xl shadow-lg shadow-primary/25 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 h-12">
              <Plus className="w-5 h-5 mr-2" />
              Create New
            </Button>
          </Link>
        </header>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-card rounded-2xl p-6 h-48 border shadow-sm animate-pulse flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="h-6 bg-muted rounded w-3/4"></div>
                  <div className="h-4 bg-muted rounded w-1/2"></div>
                </div>
                <div className="h-10 bg-muted rounded w-full mt-4"></div>
              </div>
            ))}
          </div>
        ) : programmes?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center bg-card rounded-3xl border border-dashed shadow-sm">
            <div className="bg-primary/10 p-6 rounded-full mb-6">
              <Mic className="w-12 h-12 text-primary" />
            </div>
            <h2 className="text-2xl font-display font-bold text-foreground mb-2">No programmes yet</h2>
            <p className="text-muted-foreground max-w-md mb-8">
              Start by creating a new programme using your voice. Speak your workout and let AI structure it for you.
            </p>
            <Link href="/programmes/new">
              <Button size="lg" className="rounded-xl">
                Create your first programme
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {programmes?.map((prog) => (
              <div key={prog.id} className="group relative bg-card rounded-2xl border shadow-sm hover:shadow-xl hover:border-primary/30 transition-all duration-300 flex flex-col p-6">
                
                <div className="flex justify-between items-start mb-4">
                  <div className="bg-primary/10 p-2.5 rounded-xl text-primary">
                    <Dumbbell className="w-5 h-5" />
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground -mr-2">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 rounded-xl">
                      <DropdownMenuItem onClick={() => handleDuplicate(prog.id)} className="cursor-pointer">
                        <Copy className="w-4 h-4 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDelete(prog.id)} className="cursor-pointer text-destructive focus:text-destructive">
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex-1">
                  <h3 className="text-xl font-bold text-foreground mb-2 line-clamp-2 leading-tight group-hover:text-primary transition-colors">
                    {prog.title || 'Untitled Programme'}
                  </h3>
                  
                  <div className="flex flex-col gap-2 mt-4">
                    <div className="flex items-center text-sm text-muted-foreground font-medium">
                      <List className="w-4 h-4 mr-2 opacity-70" />
                      {prog.exercises?.length || 0} exercises
                    </div>
                    <div className="flex items-center text-sm text-muted-foreground font-medium">
                      <Clock className="w-4 h-4 mr-2 opacity-70" />
                      Updated {format(new Date(prog.updatedAt), 'MMM d, yyyy')}
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border/50">
                  <Link href={`/programmes/${prog.id}`}>
                    <Button variant="ghost" className="w-full justify-between group/btn hover:bg-primary/5 hover:text-primary rounded-xl">
                      Open Builder
                      <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover/btn:opacity-100 group-hover/btn:translate-x-0 transition-all" />
                    </Button>
                  </Link>
                </div>

              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

