type Step = 1 | 2 | 3;

const labels = ['选模板', '调规则与预览', '入桌签到'] as const;

export default function WizardSteps({ step, unlocked, onStep, guest }: {
  step: Step;
  unlocked: Step;
  onStep: (step: Step) => void;
  guest: boolean;
}) {
  return <nav className="steps" aria-label="开桌步骤">
    {labels.map((label, index) => {
      const target = (index + 1) as Step;
      const title = target === 3 && guest ? '进入牌桌' : label;
      return <button key={label} type="button" className={step === target ? 'active' : ''}
        aria-current={step === target ? 'step' : undefined} disabled={target > unlocked}
        onClick={() => onStep(target)}>{String(target).padStart(2, '0')} {title}</button>;
    })}
  </nav>;
}
