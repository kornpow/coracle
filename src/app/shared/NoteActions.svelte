<script lang="ts">
  import cx from "classnames"
  import {nip19} from "nostr-tools"
  import {onMount} from "svelte"
  import {toNostrURI, Tags, createEvent} from "paravel"
  import {tweened} from "svelte/motion"
  import {identity, last, filter, sum, uniqBy, prop, pluck} from "ramda"
  import {fly} from "src/util/transition"
  import {formatSats, tryJson} from "src/util/misc"
  import {getIdOrAddressTag, asNostrEvent} from "src/util/nostr"
  import {quantify, pluralize} from "hurdak"
  import {toast} from "src/partials/state"
  import Icon from "src/partials/Icon.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Card from "src/partials/Card.svelte"
  import Heading from "src/partials/Heading.svelte"
  import Modal from "src/partials/Modal.svelte"
  import OverflowMenu from "src/partials/OverflowMenu.svelte"
  import CopyValue from "src/partials/CopyValue.svelte"
  import PersonBadge from "src/app/shared/PersonBadge.svelte"
  import HandlerSummary from "src/app/shared/HandlerSummary.svelte"
  import RelayCard from "src/app/shared/RelayCard.svelte"
  import GroupSummary from "src/app/shared/GroupSummary.svelte"
  import {router} from "src/app/router"
  import type {Event} from "src/engine"
  import {
    env,
    mute,
    unmute,
    groups,
    canSign,
    session,
    Publisher,
    mention,
    handlers,
    deriveHandlers,
    deriveIsGroupMember,
    publishToZeroOrMoreGroups,
    publishDeletionForEvent,
    getUserHints,
    getPubkeyHint,
    getPublishHints,
    getSetting,
    loadPubkeys,
    processZap,
    getEventHints,
    isEventMuted,
    getReplyTags,
    getClientTags,
  } from "src/engine"

  export let note: Event
  export let replyCtrl
  export let showMuted
  export let addToContext
  export let removeFromContext
  export let replies, likes, zaps
  export let zapper

  const relays = getEventHints(note)
  const address = Tags.from(note).circles().first()
  const nevent = nip19.neventEncode({id: note.id, relays})
  const muted = isEventMuted.derived($isEventMuted => $isEventMuted(note, true))
  const kindHandlers = deriveHandlers(note.kind).derived(filter((h: any) => h.recs.length > 1))
  const interpolate = (a, b) => t => a + Math.round((b - a) * t)
  const likesCount = tweened(0, {interpolate})
  const zapsTotal = tweened(0, {interpolate})
  const repliesCount = tweened(0, {interpolate})
  const clientTag = Tags.from(note).type("client").first()
  const handler = handlers.key(clientTag ? last(clientTag) : null)

  //const report = () => router.at("notes").of(note.id, {relays: getEventHints(note)}).at('report').qp({pubkey: note.pubkey}).open()

  const setView = v => {
    view = v
  }

  const label = () => router.at("notes").of(note.id, {relays}).at("label").open()

  const quote = () => router.at("notes/create").cx({quote: note, relays}).open()

  const unmuteNote = () => unmute(note.id)

  const muteNote = () => mute("e", note.id)

  const react = async content => {
    const relays = getPublishHints(note)
    const template = createEvent(7, {
      content,
      tags: [...getReplyTags(note), ...getClientTags()],
    })

    if (!note.wrap) {
      Publisher.publish({relays, event: asNostrEvent(note)})
    }

    const {events} = await publishToZeroOrMoreGroups([address].filter(identity), template, {relays})

    addToContext(events)
  }

  const deleteReaction = e => {
    publishDeletionForEvent(e)

    removeFromContext(e)
  }

  const crossPost = async (address = null) => {
    const relays = getPublishHints(note)
    const content = JSON.stringify(asNostrEvent(note))
    const tags = [getIdOrAddressTag(note, relays[0]), mention(note.pubkey), ...getClientTags()]

    let template
    if (note.kind === 1) {
      template = createEvent(6, {content, tags})
    } else {
      template = createEvent(16, {content, tags: [...tags, ["k", note.kind]]})
    }

    publishToZeroOrMoreGroups([address].filter(identity), template, {relays})

    toast.show("info", "Note has been cross-posted!")

    setView(null)
  }

  const startZap = () => {
    const zapTags = Tags.from(note).type("zap")
    const defaultSplit = ["zap", note.pubkey, getPubkeyHint(note.pubkey), "1"]
    const splits = zapTags.exists() ? zapTags.all() : [defaultSplit]

    router
      .at("zap")
      .qp({
        splits,
        eid: note.id,
        anonymous: Boolean(note.wrap),
      })
      .cx({callback: addToContext})
      .open()
  }

  const broadcast = () => {
    const relays = getUserHints("write")
    const event = asNostrEvent(note)

    Publisher.publish({event, relays})

    toast.show("info", "Note has been re-published!")
  }

  const groupOptions = session.derived($session => {
    const options = []

    for (const addr of Object.keys($session?.groups || {})) {
      const group = groups.key(addr).get()
      const isMember = deriveIsGroupMember(addr).get()

      if (group && isMember && addr !== address) {
        options.push(group)
      }
    }

    return uniqBy(prop("address"), options)
  })

  let view
  let actions = []

  $: disableActions =
    !$canSign ||
    ($muted && !showMuted) ||
    (note.wrap && address && !deriveIsGroupMember(address).get())
  $: like = likes.find(e => e.pubkey === $session?.pubkey)
  $: $likesCount = likes.length
  $: zap = zaps.find(e => e.request.pubkey === $session?.pubkey)

  $: {
    const filteredZaps: {invoiceAmount: number}[] = zap
      ? zaps.filter(n => n.id !== zap?.id).concat(processZap(zap, zapper))
      : zaps

    $zapsTotal = sum(pluck("invoiceAmount", filteredZaps)) / 1000
  }

  $: canZap = zapper && note.pubkey !== $session?.pubkey
  $: reply = replies.find(e => e.pubkey === $session?.pubkey)
  $: $repliesCount = replies.length

  $: {
    actions = []

    if ($canSign) {
      actions.push({label: "Quote", icon: "quote-left", onClick: quote})

      if (!note.wrap && !$env.FORCE_GROUP && ($groupOptions.length > 0 || address)) {
        actions.push({label: "Cross-post", icon: "shuffle", onClick: () => setView("cross-post")})
      }

      actions.push({label: "Tag", icon: "tag", onClick: label})
      //actions.push({label: "Report", icon: "triangle-exclamation", onClick: report})

      if ($muted) {
        actions.push({label: "Unmute", icon: "microphone", onClick: unmuteNote})
      } else {
        actions.push({label: "Mute", icon: "microphone-slash", onClick: muteNote})
      }
    }

    if (!$env.FORCE_GROUP && $env.FORCE_RELAYS.length === 0 && !note.wrap) {
      actions.push({label: "Broadcast", icon: "rss", onClick: broadcast})
    }

    actions.push({
      label: "Details",
      icon: "info",
      onClick: () => setView("info"),
    })
  }

  onMount(() => {
    loadPubkeys(Tags.from(note).type("zap").pubkeys().all())
  })
</script>

<div class="flex justify-between text-neutral-100" on:click|stopPropagation>
  <div class="flex gap-8 text-sm">
    <button
      class={cx("relative flex items-center gap-1 pt-1 transition-all hover:pb-1 hover:pt-0", {
        "pointer-events-none opacity-50": disableActions,
      })}
      on:click={replyCtrl?.start}>
      <Icon icon="message" accent={Boolean(reply)} />
      {#if $repliesCount > 0}
        <span transition:fly|local={{y: 5, duration: 100}} class="-mt-px">{$repliesCount}</span>
      {/if}
    </button>
    {#if $env.ENABLE_ZAPS}
      <button
        class={cx("relative flex items-center gap-1 pt-1 transition-all hover:pb-1 hover:pt-0", {
          "pointer-events-none opacity-50": disableActions || !canZap,
        })}
        on:click={startZap}>
        <Icon icon="bolt" accent={Boolean(zap)} />
        {#if $zapsTotal > 0}
          <span transition:fly|local={{y: 5, duration: 100}} class="-mt-px"
            >{formatSats($zapsTotal)}</span>
        {/if}
      </button>
    {/if}
    {#if getSetting("enable_reactions")}
      <button
        class={cx("relative flex items-center gap-1 pt-1 transition-all hover:pb-1 hover:pt-0", {
          "pointer-events-none opacity-50": disableActions || note.pubkey === $session?.pubkey,
        })}
        on:click={() => (like ? deleteReaction(like) : react("+"))}>
        <Icon
          icon="heart"
          accent={Boolean(like)}
          class={cx("cursor-pointer", {
            "fa-beat fa-beat-custom": like,
          })} />
        {#if $likesCount > 0}
          <span transition:fly|local={{y: 5, duration: 100}} class="-mt-px">{$likesCount}</span>
        {/if}
      </button>
    {/if}
  </div>
  <div class="flex scale-90 items-center gap-2">
    <div
      class="staatliches cursor-pointer rounded bg-neutral-800 dark:bg-neutral-600 px-2 text-neutral-100 transition-colors dark:hover:bg-neutral-500 hover:bg-neutral-700 hidden sm:block"
      on:click={() => setView("info")}>
      <span class="text-accent">{note.seen_on.length}</span>
      {pluralize(note.seen_on.length, "relay")}
    </div>
    <OverflowMenu {actions} />
  </div>
</div>

{#if view}
  <Modal onEscape={() => setView(null)}>
    {#if view === "info"}
      {#if zaps.length > 0}
        <h1 class="staatliches text-2xl">Zapped By</h1>
        <div class="grid grid-cols-2 gap-2">
          {#each zaps as zap}
            <div class="flex flex-col gap-1">
              <PersonBadge pubkey={zap.request.pubkey} />
              <span class="ml-16 text-sm text-neutral-600"
                >{formatSats(zap.invoiceAmount / 1000)} sats</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if likes.length > 0}
        <h1 class="staatliches text-2xl">Liked By</h1>
        <div class="grid grid-cols-2 gap-2">
          {#each likes as like}
            <PersonBadge pubkey={like.pubkey} />
          {/each}
        </div>
      {/if}
      {#if note.seen_on.length > 0 && $env.FORCE_RELAYS.length < 2}
        <h1 class="staatliches text-2xl">Relays</h1>
        <p>This note was found on {quantify(note.seen_on.length, "relay")} below.</p>
        <div class="flex flex-col gap-2">
          {#each note.seen_on as url}
            <RelayCard relay={{url}} />
          {/each}
        </div>
      {/if}
      {#if $kindHandlers.length > 0 || $handler}
        <h1 class="staatliches text-2xl">Apps</h1>
        {#if $handler}
          {@const meta = tryJson(() => JSON.parse($handler.event.content))}
          <p>This note was published using {meta?.display_name || meta?.name}.</p>
          <HandlerSummary event={$handler.event} />
        {/if}
        {#if $kindHandlers.length > 0}
          <p>This note can also be viewed using other nostr apps:</p>
          <FlexColumn>
            {#each $kindHandlers as { address, event, recs } (address)}
              <HandlerSummary {event} {recs} />
            {/each}
          </FlexColumn>
        {/if}
      {/if}
      <h1 class="staatliches text-2xl">Details</h1>
      <CopyValue label="Link" value={toNostrURI(nevent)} />
      <CopyValue label="Event ID" encode={nip19.noteEncode} value={note.id} />
      <CopyValue label="Event JSON" value={JSON.stringify(asNostrEvent(note))} />
    {:else if view === "cross-post"}
      <div class="mb-4 flex items-center justify-center">
        <Heading>Cross-post</Heading>
      </div>
      <div>Select where you'd like to post to:</div>
      <div class="flex flex-col gap-2">
        {#if address}
          <Card invertColors interactive on:click={() => crossPost()}>
            <div class="flex gap-4 text-neutral-100">
              <i class="fa fa-earth-asia fa-2x" />
              <div class="flex min-w-0 flex-grow flex-col gap-4">
                <p class="text-2xl">Global</p>
                <p>Post to your main feed.</p>
              </div>
            </div>
          </Card>
        {/if}
        {#each $groupOptions as g (g.address)}
          <Card invertColors interactive on:click={() => crossPost(g.address)}>
            <GroupSummary address={g.address} />
          </Card>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}
