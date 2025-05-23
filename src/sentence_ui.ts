// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import './batch_name_ui';
import './matcher_ui';

import {css, html, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

import {BatchSelection} from './batch_selection';
import {Batch, DISTORTION_METRIC_FIELD_IDS, Field, FieldId, fieldUnit} from './entry';
import {dispatch, EventType, listen} from './events';
import {FieldFilterWithIndex} from './filter';
import {FieldMatcher} from './matcher';
import {FieldMetric, FieldMetricStats} from './metric';
import {State} from './state';

/**
 * Component displaying a summary of the whole comparison ("simple interface").
 */
@customElement('sentence-ui')
export class SentenceUi extends LitElement {
  @property({attribute: false}) state!: State;

  override connectedCallback() {
    super.connectedCallback();
    listen(EventType.MATCHED_DATA_POINTS_CHANGED, () => {
      this.requestUpdate();
    });
  }

  // Matchers

  private renderMatcher(
      matcher: FieldMatcher, index: number, numEnabledMatchers: number) {
    let displayName: string|undefined = undefined;
    let subName: string|undefined = undefined;
    for (const batch of this.state.batches) {
      const field = batch.fields[matcher.fieldIndices[batch.index]];
      if (field.displayName === '') continue;
      if (field.id === FieldId.SOURCE_IMAGE_NAME) {
        displayName = field.displayName;
        if (this.state.batchesAreLikelyLossless) {
          subName = 'encoded losslessly';
        } else {
          // There should be an enabled distortion-based matcher. No need to
          // mention that the compression is lossy.
        }
      } else if (DISTORTION_METRIC_FIELD_IDS.includes(field.id)) {
        displayName = 'distortion';
        subName = field.displayName;
      } else {
        displayName = field.displayName;
      }
      break;
    }
    if (displayName === '') return html``;

    const isFirst = index === 0;
    const isLast = index === numEnabledMatchers - 1;
    const tolerance: string|undefined = matcher.tolerance !== 0 ?
        `±${(matcher.tolerance * 100).toFixed(1)}%` :
        undefined;
    const paren = subName ?
        (tolerance ? ` (${subName} ${tolerance})` : ` (${subName})`) :
        (tolerance ? ` (${tolerance})` : '');
    const lineEnd = isLast ?
        (this.state.showRelativeRatios ? html`,` : html``) :
        html`<br>`;

    return html`
        ${isFirst ? 'For' : 'and'} the same ${displayName}${paren}${lineEnd}`;
  }

  private renderMatchers() {
    const numEnabledMatchers =
        this.state.matchers.filter(matcher => matcher.enabled).length;
    let index = 0;
    return html`
        <p>
          ${
        this.state.matchers.map(
            matcher => matcher.enabled ?
                this.renderMatcher(matcher, index++, numEnabledMatchers) :
                '')}
        </p>`;
  }

  // Batches, filters and metrics

  private renderFilters(batchSelection: BatchSelection) {
    const batch = batchSelection.batch;
    let numFilters = 0;
    const filters = html`${
        batchSelection.fieldFilters.map((filter: FieldFilterWithIndex) => {
          const field = batch.fields[filter.fieldIndex];
          return (filter.fieldFilter.enabled &&
                  filter.fieldFilter.actuallyFiltersPointsOut(field)) ?
              html`${numFilters++ > 0 ? ', ' : ''}${
                  filter.fieldFilter.toString(field, /*short=*/ false)}` :
              '';
        })}`;
    if (numFilters === 0) return html``;
    return html`<br><span class="filters">(${filters})</span>`;
  }

  private renderAbsoluteMetric(
      batch: Batch, metric: FieldMetric, stats: FieldMetricStats) {
    const field = batch.fields[metric.fieldIndices[batch.index]];
    const mean = stats.getAbsoluteMean().toFixed(2);

    switch (field.id) {
      case FieldId.ENCODED_SIZE:
        return html`weigh ${mean} bytes`;
      case FieldId.ENCODING_DURATION:
        return html`take ${mean} seconds to encode`;
      case FieldId.DECODING_DURATION:
        return html`take ${mean} seconds to decode`;
      case FieldId.RAW_DECODING_DURATION:
        return html`take ${
            mean} seconds to decode (exclusive of color conversion)`;
      default:
        const unit = fieldUnit(field.id);
        return html`result in ${mean}${unit} as ${field.displayName}`;
    }
  }

  private renderRelativeMetric(
      batch: Batch, metric: FieldMetric, stats: FieldMetricStats) {
    const field = batch.fields[metric.fieldIndices[batch.index]];
    const mean = stats.getRelativeMean(this.state.useGeometricMean);

    if (mean === 1) {
      switch (field.id) {
        case FieldId.ENCODED_SIZE:
        case FieldId.ENCODED_BITS_PER_PIXEL:
          return html`as big`;
        case FieldId.ENCODING_DURATION:
          return html`as fast to encode`;
        case FieldId.DECODING_DURATION:
          return html`as slow to decode`;
        case FieldId.RAW_DECODING_DURATION:
          return html`as slow to decode (exclusive of color conversion)`;
        default:
          return html`of the same ${field.displayName}`;
      }
    }

    const neg = mean < 1;
    const xTimes = String(
        neg ? (1 / mean).toFixed(2) + ' times' : mean.toFixed(2) + ' times');

    switch (field.id) {
      case FieldId.ENCODED_SIZE:
      case FieldId.ENCODED_BITS_PER_PIXEL:
        return html`${xTimes} ${neg ? 'smaller' : 'bigger'}`;
      case FieldId.ENCODING_DURATION:
        return html`${xTimes} ${neg ? 'faster' : 'slower'} to encode`;
      case FieldId.DECODING_DURATION:
        return html`${xTimes} ${neg ? 'faster' : 'slower'} to decode`;
      case FieldId.RAW_DECODING_DURATION:
        return html`${xTimes} ${
            neg ? 'faster' :
                  'slower'} to decode (exclusive of color conversion)`;
      default:
        return html`${xTimes} ${neg ? 'lower' : 'higher'} on the ${
            field.displayName} scale`;
    }
  }

  private renderBatch(batchSelection: BatchSelection, isLast: boolean) {
    const batch = batchSelection.batch;
    const lastEnabledMetricIndex = isLast ?
        Math.max(...this.state.metrics.map(
            (metric, index) => metric.enabled ? index : -1)) :
        -1;

    return html`
        <p><batch-name-ui .batch=${batch} @click=${() => {
      dispatch(EventType.BATCH_INFO_REQUEST, {batchIndex: batch.index});
    }}></batch-name-ui> files
        ${this.renderFilters(batchSelection)}
        ${this.state.showRelativeRatios ? 'are' : ''}
        ${this.state.metrics.map((metric: FieldMetric, metricIndex: number) => {
      return metric.enabled ?
          html`<br>${
              this.state.showRelativeRatios ?
                  this.renderRelativeMetric(
                      batch, metric, batchSelection.stats[metricIndex]) :
                  this.renderAbsoluteMetric(
                      batch, metric, batchSelection.stats[metricIndex])}${
              metricIndex === lastEnabledMetricIndex ? '.' : ','}` :
          '';
    })}
        </p>`;
  }

  private renderBatches() {
    const shouldBatchBeDisplayed = (batchSelection: BatchSelection) =>
        (!this.state.showRelativeRatios ||
         batchSelection.batch.index !==
             this.state.referenceBatchSelectionIndex) &&
        batchSelection.isDisplayed &&
        batchSelection.matchedDataPoints.rows.length > 0;
    const lastDisplayedBatchIndex = Math.max(...this.state.batchSelections.map(
        (batchSelection, index) =>
            shouldBatchBeDisplayed(batchSelection) ? index : -1));

    return html`${this.state.batchSelections.map((batchSelection, index) => {
      return shouldBatchBeDisplayed(batchSelection) ?
          this.renderBatch(
              batchSelection, /*isLast=*/ index === lastDisplayedBatchIndex) :
          '';
    })}`;
  }

  // Reference

  private renderMatcherReference(referenceBatch: BatchSelection) {
    if (this.state.showRelativeRatios) {
      return html``;
    }
    const batch = referenceBatch.batch;
    return html`
      <p id="referenceBatch">
        as <batch-name-ui id="referenceBatchNameUi" .batch=${batch}
            @click=${() => {
      dispatch(EventType.BATCH_INFO_REQUEST, {batchIndex: batch.index});
    }}></batch-name-ui>${this.renderFilters(referenceBatch)},
      </p>`;
  }

  private renderReference(referenceBatch: BatchSelection) {
    if (this.state.showRelativeRatios) {
      const batch = referenceBatch.batch;
      return html`
        <p id="referenceBatch">
          compared to <batch-name-ui id="referenceBatchNameUi" .batch=${batch}
                        @click=${() => {
        dispatch(EventType.BATCH_INFO_REQUEST, {batchIndex: batch.index});
      }}></batch-name-ui>${this.renderFilters(referenceBatch)},</p>`;
    }
    return html`<p id="referenceBatch">on average,</p>`;
  }

  private renderMatches() {
    let referenceBatch: BatchSelection|undefined = undefined;
    if (this.state.referenceBatchSelectionIndex >= 0 &&
        this.state.referenceBatchSelectionIndex <
            this.state.batchSelections.length) {
      referenceBatch =
          this.state.batchSelections[this.state.referenceBatchSelectionIndex];
    }

    return html`
      <div id="matchers">
        ${this.renderMatchers()}
        ${referenceBatch ? this.renderMatcherReference(referenceBatch) : ''}
      </div>
      ${referenceBatch ? this.renderReference(referenceBatch) : ''}`;
  }

  private renderRdMode() {
    // Keep element ids as in renderMatches() for consistency, even if they do
    // not really relate.
    return html`
      <div id="matchers">
        <p id="referenceBatch">On average,</p>
      </div>`;
  }

  override render() {
    return html`
      ${this.state.rdMode ? this.renderRdMode() : this.renderMatches()}
      <div id="batches">
        ${this.renderBatches()}
      </div>`;
  }

  static override styles = css`
    :host {
      padding: 10px 0;
    }
    p {
      margin: 10px 0;
      color: var(--mdc-theme-text);
      font-size: 20px;
    }
    batch-name-ui:hover {
      cursor: pointer;
    }
    .filters{
      font-size: 14px;
    }
  `;
}
