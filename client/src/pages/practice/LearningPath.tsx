import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ChevronRight,
  Lock,
  CheckCircle,
  Circle,
  PlayCircle,
  Trophy,
} from "lucide-react";

const learningPaths = [
  {
    id: 1,
    title: "Fundamentals of Programming",
    description: "Master the basics of coding with hands-on exercises",
    progress: 60,
    icon: "🚀",
    levels: [
      {
        id: 1,
        name: "Variables & Data Types",
        status: "completed",
        exercises: 10,
        points: 100,
      },
      {
        id: 2,
        name: "Control Structures",
        status: "completed",
        exercises: 15,
        points: 150,
      },
      {
        id: 3,
        name: "Functions & Methods",
        status: "in-progress",
        exercises: 12,
        points: 120,
      },
      {
        id: 4,
        name: "Arrays & Lists",
        status: "locked",
        exercises: 20,
        points: 200,
      },
      {
        id: 5,
        name: "Object-Oriented Programming",
        status: "locked",
        exercises: 25,
        points: 250,
      },
    ],
  },
  {
    id: 2,
    title: "Data Structures & Algorithms",
    description: "Learn essential DS&A concepts for coding interviews",
    progress: 30,
    icon: "🧠",
    levels: [
      {
        id: 1,
        name: "Big O Notation",
        status: "completed",
        exercises: 8,
        points: 80,
      },
      {
        id: 2,
        name: "Arrays & Strings",
        status: "in-progress",
        exercises: 15,
        points: 150,
      },
      {
        id: 3,
        name: "Linked Lists",
        status: "locked",
        exercises: 12,
        points: 120,
      },
      {
        id: 4,
        name: "Stacks & Queues",
        status: "locked",
        exercises: 10,
        points: 100,
      },
      {
        id: 5,
        name: "Trees & Graphs",
        status: "locked",
        exercises: 20,
        points: 200,
      },
    ],
  },
  {
    id: 3,
    title: "Web Development Fundamentals",
    description: "Build your first web applications from scratch",
    progress: 0,
    icon: "🌐",
    levels: [
      {
        id: 1,
        name: "HTML Basics",
        status: "locked",
        exercises: 10,
        points: 100,
      },
      {
        id: 2,
        name: "CSS Styling",
        status: "locked",
        exercises: 15,
        points: 150,
      },
      {
        id: 3,
        name: "JavaScript Essentials",
        status: "locked",
        exercises: 20,
        points: 200,
      },
      {
        id: 4,
        name: "DOM Manipulation",
        status: "locked",
        exercises: 12,
        points: 120,
      },
      {
        id: 5,
        name: "Intro to React",
        status: "locked",
        exercises: 25,
        points: 250,
      },
    ],
  },
];

const LevelStatus = ({ status }: { status: string }) => {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "in-progress":
      return <PlayCircle className="h-5 w-5 text-blue-500" />;
    case "locked":
      return <Lock className="h-5 w-5 text-slate-500" />;
    default:
      return <Circle className="h-5 w-5 text-slate-500" />;
  }
};

export default function LearningPath() {
  return (
    <div className="flex-1 bg-slate-900 min-h-screen">
      <ScrollArea className="h-screen">
        <div className="p-8 max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold mb-2 text-slate-100">
              Learning Paths
            </h1>
            <p className="text-xl text-slate-400">
              Embark on a journey to master coding skills
            </p>
          </div>

          <div className="space-y-8">
            {learningPaths.map((path) => (
              <Card
                key={path.id}
                className="bg-slate-800/50 border-slate-700 hover:bg-slate-800/70 transition-colors overflow-hidden"
              >
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="text-4xl">{path.icon}</div>
                      <div>
                        <CardTitle className="text-2xl font-semibold text-slate-100">
                          {path.title}
                        </CardTitle>
                        <CardDescription className="text-slate-400">
                          {path.description}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-blue-500/20 text-blue-300 px-3 py-1 text-sm"
                    >
                      {path.progress}% Complete
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={path.progress}
                    className="h-2 mb-6 bg-slate-700"
                  />
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="levels">
                      <AccordionTrigger className="text-slate-200 hover:text-slate-100">
                        View Levels
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 mt-2">
                          {path.levels.map((level) => (
                            <div
                              key={level.id}
                              className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"
                            >
                              <div className="flex items-center space-x-3">
                                <LevelStatus status={level.status} />
                                <span className="text-slate-200">
                                  {level.name}
                                </span>
                              </div>
                              <div className="flex items-center space-x-4">
                                <div className="flex items-center space-x-1">
                                  <Trophy className="h-4 w-4 text-yellow-500" />
                                  <span className="text-sm text-slate-400">
                                    {level.points} pts
                                  </span>
                                </div>
                                {level.status !== "locked" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-slate-300 hover:text-slate-100"
                                  >
                                    {level.status === "completed"
                                      ? "Review"
                                      : "Continue"}
                                    <ChevronRight className="ml-2 h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                  <Button className="w-full mt-6 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600">
                    {path.progress === 0
                      ? "Start Learning Path"
                      : "Continue Learning"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
