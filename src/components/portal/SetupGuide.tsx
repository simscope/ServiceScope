import type { ReactNode } from 'react';

type SetupGuideProps = {
  title: string;
  intro: string;
  steps: string[];
  prepare?: ReactNode;
  complete: string;
};

export function SetupGuide({ title, intro, steps, prepare, complete }: SetupGuideProps) {
  return (
    <details className="setup-guide">
      <summary>{title}</summary>
      <div className="setup-guide-body">
        <p>{intro}</p>
        {prepare ? (
          <div className="setup-guide-callout">
            <strong>Before you start</strong>
            <span>{prepare}</span>
          </div>
        ) : null}
        <ol>
          {steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <div className="setup-guide-complete">
          <strong>Done when</strong>
          <span>{complete}</span>
        </div>
      </div>
    </details>
  );
}
