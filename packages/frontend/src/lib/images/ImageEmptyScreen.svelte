<script lang="ts">
import { EmptyScreen } from '@podman-desktop/ui-svelte';
import FirstImageScreen from '../FirstImage.svelte';
import BootcImageIcon from '../BootcImageIcon.svelte';
</script>

<EmptyScreen
  icon={BootcImageIcon}
  title="No bootable container images">
  <div slot="upperContent">
    <FirstImageScreen/>
  </div>
</EmptyScreen>
