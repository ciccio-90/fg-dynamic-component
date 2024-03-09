import { ChangeDetectionStrategy, Component, ComponentRef, ElementRef, EventEmitter, InputSignal, ModelSignal, OnDestroy, Renderer2, Signal, Type, ViewContainerRef, inject, input, model, viewChild, viewChildren } from '@angular/core';
import { AsyncValidator, AsyncValidatorFn, ControlValueAccessor, FormControl, FormControlDirective, FormGroup, NG_ASYNC_VALIDATORS, NG_VALIDATORS, NG_VALUE_ACCESSOR, Validator, ValidatorFn, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';

export interface FGDynamicItem {
    type?: string | Type<unknown> | Promise<Type<unknown>>;
    inputs?: Record<string, string | unknown>;
    outputs?: Record<string, string | Function>;
    attributes?: Record<string, string | unknown>;
    hidden?: string | boolean;
    disabled?: string | boolean;
    modelProperty?: string;
    min?: string | number;
    max?: string | number;
    required?: string | boolean;
    email?: string | boolean;
    minLength?: string | number;
    maxLength?: string | number;
    pattern?: string | RegExp
    items?: FGDynamicItem[];
}

export class FGDynamicService {
    private static _components: Record<string, Type<unknown>> = {};

    static registerComponent(name: string, type: Type<unknown>): void {
        if (name && type) {
            FGDynamicService._components[name] = type;
        }
    }

    static getComponentByName(name: string): Type<unknown> {
        return FGDynamicService._components[name];
    }
}

@Component({
	selector: 'fg-dynamic',
	template: `
        <ng-container #viewContainer></ng-container>
        @for (item of configuration()?.items; track $index) {
            <fg-dynamic #dynamicItem [configuration]="item" [(viewModel)]="viewModel" [formGroup]="formGroup()" />
        }
    `,
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true
})
export class FGDynamicComponent implements OnDestroy {
	configuration: InputSignal<FGDynamicItem> = input.required<FGDynamicItem>();
	viewModel: ModelSignal<unknown> = model<unknown>();
	formGroup: InputSignal<FormGroup> = input<FormGroup>();

	private _viewContainerRef: Signal<ViewContainerRef> = viewChild.required('viewContainer', {
        read: ViewContainerRef
    });
    private _dynamicItems: Signal<readonly ElementRef<unknown>[]> = viewChildren('dynamicItem', {
        read: ElementRef
    });
	private _componentRef: ComponentRef<unknown>;
    private _elementRef: ElementRef<HTMLElement> = inject(ElementRef);
    private _renderer: Renderer2 = inject(Renderer2);
    private _outputsSubscriptions: Subscription[] = [];
    private _formControl: FormControl;
    private _formControlDirective: FormControlDirective;
    private _formGroupSubscription: Subscription;
    private _component: Type<unknown>;

    async ngOnChanges(): Promise<void> {
        await this.loadComponentAsync();
        this.createComponent();
        this.setInputs();
        this.setAttributes();
        this.setVisibility();
        this.setFormControlStatus();
        this.setFormControlValidators();
    }

    private async loadComponentAsync(): Promise<void> {
        if (this.configuration().type != null && !this._component) {
            if (typeof(this.configuration().type) === 'string') {
                this._component = FGDynamicService.getComponentByName(this.configuration().type as string);
            } else {
                this._component = await (this.configuration().type as (Type<unknown> | Promise<Type<unknown>>));
            }
        }
    }

    private createComponent(): void {
        if (this._component && !this._componentRef && this._viewContainerRef()) {
            this._componentRef = this._viewContainerRef().createComponent(this._component, {
                projectableNodes: this._dynamicItems()?.length > 0 ? [this._dynamicItems().map((e: ElementRef<unknown>): Node => e.nativeElement as Node)] : undefined
            });

            if (this._componentRef?.changeDetectorRef) {
                this._componentRef.changeDetectorRef.markForCheck();
            }

            this.removeHostElement();
            this.handleOutputs();
            this.createFormControl();
        }
    }

    private removeHostElement(): void {
        if (this._elementRef?.nativeElement?.parentElement) {
            const nativeElement: HTMLElement = this._elementRef.nativeElement;
            const parentElement: HTMLElement = nativeElement.parentElement;

            // Move all children out of the element
            while (nativeElement.firstChild) {
                parentElement.insertBefore(nativeElement.firstChild, nativeElement);
            }

            // Remove the empty element (the host)
            parentElement.removeChild(nativeElement);
        }
    }

    private handleOutputs(): void {
        this._outputsSubscriptions?.forEach((s: Subscription): void => s.unsubscribe());

        if (this.configuration()?.outputs && this._componentRef?.instance) {
            for (const outputName in this.configuration().outputs) {
                if (this._componentRef.instance[outputName] instanceof EventEmitter) {
                    this._outputsSubscriptions?.push(this._componentRef.instance[outputName].subscribe(($event: unknown): void => {
                        const result: unknown = this.evaluateExpression(this.configuration().outputs[outputName], this.viewModel, $event);

                        if (result instanceof Function) {
                            result($event)
                        }
                    }));
                }
            }
        }
    }

    private createFormControl(): void {
        if (this.formGroup() && this.configuration()?.modelProperty && this.viewModel()) {
            this._formControl = new FormControl(this.getModelPropertyValue(this.viewModel(), this.configuration().modelProperty, null));

            this.formGroup().addControl(this.configuration().modelProperty, this._formControl);
            this._formGroupSubscription?.unsubscribe();

            this._formGroupSubscription = this.formGroup().valueChanges.subscribe((): void => {
                const model: unknown = this.formGroup().getRawValue();

                if (model) {
                    const value: unknown = this.getModelPropertyValue(model, this.configuration().modelProperty, null);
                    const viewModel: unknown = structuredClone(this.viewModel());

                    this.setModelPropertyValue(viewModel, this.configuration().modelProperty, value);
                    this.viewModel.set(viewModel);
                }
            });

            this.attachFormControlDirective();
        }
    }

    private setFormControlStatus(): void {
        if (this._formControl && this.configuration()?.disabled != null) {
            const isDisabled: boolean = this.evaluateExpression(this.configuration().disabled, this.viewModel) as boolean;

            if (isDisabled) {
                this._formControl.disable({
                    onlySelf: true,
                    emitEvent: false
                });
            } else {
                this._formControl.enable({
                    onlySelf: true,
                    emitEvent: false
                });
            }
        }
    }

    private setFormControlValidators(): void {
        if (this._formControl && this.configuration()) {
            this._formControl.clearValidators();

            const validators: ValidatorFn[] = [];
            const min = this.evaluateExpression(this.configuration().min, this.viewModel) as number;

            if (typeof(min) === 'number') {
                validators.push(Validators.min(min));
            }

            const max = this.evaluateExpression(this.configuration().max, this.viewModel) as number;

            if (typeof(max) === 'number') {
                validators.push(Validators.max(max));
            }

            const required = this.evaluateExpression(this.configuration().required, this.viewModel) as boolean;

            if (required === true) {
                validators.push(Validators.required);
            }

            const email = this.evaluateExpression(this.configuration().email, this.viewModel) as boolean;

            if (email === true) {
                validators.push(Validators.email);
            }

            const maxLength = this.evaluateExpression(this.configuration().maxLength, this.viewModel) as number;

            if (maxLength > 0) {
                validators.push(Validators.maxLength(maxLength));
            }

            const minLength = this.evaluateExpression(this.configuration().minLength, this.viewModel) as number;

            if (minLength > 0) {
                validators.push(Validators.minLength(minLength));
            }

            const pattern = this.evaluateExpression(this.configuration().minLength, this.viewModel) as (string | RegExp);

            if (typeof(pattern) === 'string' || pattern instanceof RegExp) {
                validators.push(Validators.pattern(pattern));
            }

            this._formControl.addValidators(validators);
            this._formControl.updateValueAndValidity({
                onlySelf: true,
                emitEvent: false
            });
        }
    }

    private attachFormControlDirective(): void {
        if (!this._formControlDirective && this._componentRef?.injector) {
            const validators: (Validator | ValidatorFn)[] = this._componentRef.injector.get<(Validator | ValidatorFn)[]>(NG_VALIDATORS, null);
            const asyncValidators: (AsyncValidator | AsyncValidatorFn)[] = this._componentRef.injector.get<(AsyncValidator | AsyncValidatorFn)[]>(NG_ASYNC_VALIDATORS, null);
            const valueAccessors: ControlValueAccessor[] = this._componentRef.injector.get<ControlValueAccessor[]>(NG_VALUE_ACCESSOR, null);

            this._formControlDirective = new FormControlDirective(validators, asyncValidators, valueAccessors, null);

            this._formControlDirective.form = this._formControl;

            this._formControlDirective.ngOnChanges({
                form: {
                    firstChange: true,
                    currentValue: this._formControl,
                    previousValue: undefined,
                    isFirstChange: (): true => true
                }
            });
        }
    }

    private getModelPropertyValue(model: unknown, property: Array<string> | string, defaultValue: unknown): unknown {
        // If path is not defined or it has false value
        if (!property) {
            return undefined
        }

        // Check if path is string or array. Regex : ensure that we do not have '.' and brackets.
        const pathArray: string[] = Array.isArray(property) ? property : property.match(/([^[.\]])+/g);
        // Find value
        const result: unknown = pathArray.reduce((prevObj: unknown, key: string): unknown => prevObj && prevObj[key], model);

        // If found value is undefined return default value; otherwise return the value
        return result != null ? result : defaultValue
    }

    private setModelPropertyValue(model: unknown, property: Array<string> | string, value: unknown): void {
        const pathArray: string[] = Array.isArray(property) ? property : property.match(/([^[.\]])+/g);

        pathArray.reduce((acc: unknown, key: string, i: number): unknown => {
            if (acc[key] === undefined) {
                acc[key] = {};
            }

            if (i === pathArray.length - 1) {
                acc[key] = value;
            }

            return acc[key]
        }, model);
    }

    private setInputs(): void {
        if (this.configuration()?.inputs && this._componentRef) {
            for (const inputName in this.configuration().inputs) {
                this._componentRef.setInput(inputName, this.evaluateExpression(this.configuration().inputs[inputName], this.viewModel));
            }
        }
    }

    private setAttributes(): void {
        if (this.configuration()?.attributes && this._componentRef) {
            for (const attributeName in this.configuration().attributes) {
                this._renderer.setAttribute(this._componentRef.location.nativeElement, attributeName, this.evaluateExpression(this.configuration().attributes[attributeName], this.viewModel) as string);
            }
        }
    }

    private setVisibility(): void {
        if (this.configuration()?.hidden != null && this._componentRef) {
            const hidden: boolean = this.evaluateExpression(this.configuration().hidden, this.viewModel) as boolean;

            if (hidden) {
                this._renderer.setStyle(this._componentRef.location.nativeElement, 'display', 'none');
            } else {
                this._renderer.removeStyle(this._componentRef.location.nativeElement, 'display');
            }
        }
    }

    private evaluateExpression(value: unknown, $vm?: ModelSignal<unknown>, $event?: unknown): unknown {
        if (typeof(value) === 'string' && ((value.includes('$vm') && $vm() != null) || (value.includes('$event') && $event != null))) {
            return eval(value);
        } else {
            return value;
        }
    }

	ngOnDestroy(): void {
        this._outputsSubscriptions?.forEach((s: Subscription): void => s.unsubscribe());
        this._formGroupSubscription?.unsubscribe();
        this._formControlDirective?.ngOnDestroy();
        this._componentRef?.destroy();
	}
}
