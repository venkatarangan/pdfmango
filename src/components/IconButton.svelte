<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { IconName } from '../lib/icons';
  import Icon from './Icon.svelte';

  /** `tipEnd`: the button sits at the right edge, so its tooltip lines up with its right side. */
  type Props = HTMLButtonAttributes & { icon: IconName; label: string; tipAbove?: boolean; tipEnd?: boolean };
  let { icon, label, tipAbove = false, tipEnd = false, class: cls = '', ...rest }: Props = $props();
</script>

<button type="button" class="icon-btn tip {cls}" class:tip-above={tipAbove} class:tip-end={tipEnd} aria-label={label} data-tip={label} {...rest}>
  <Icon name={icon} />
</button>
